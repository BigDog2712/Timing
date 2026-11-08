//! 计时业务（单一事实来源）：状态机、撤销窗口、崩溃恢复、周期落盘。
//!
//! 时间口径（IPC-CONTRACT-v2 §1/§4/R-4）：
//!   实时累计 = accumulated_sec + 自锚点以来的真实流逝秒数
//!
//! **两种时钟各管一段**（v0.3，见 `platform::clock`）：
//!   - 落库字段（`started_at` / `ended_at` / `running_since`）用**墙钟**——跨进程重启必须能对齐；
//!   - 「这次跑了多久」用**单调时钟**——墙钟会被 NTP 校时 / 手动改时拉走，用它算时长会跳变。
//!
//! 锚点（`clock::anchor`）把某个墙钟时刻钉到一个单调时刻上；`flush_active` 每次折账后
//! 重新锚定，因此「墙钟前跳」不会多计、「墙钟回拨」也不会丢一段。
//! 锚点缺失（进程重启、单元测试构造的记录）时自动退回纯墙钟差值——行为与 v0.2 一致。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::constants::{SYSTEM_ITEM_ID, UNDO_TOLERANCE_MS, UNDO_WINDOW_MS};
use crate::models::enums::{record_status, timer_status, SwitchMode};
// 托盘快照相关类型仅桌面用（移动端没有菜单可填），故只进桌面编译。
#[cfg(desktop)]
use crate::models::enums::{timer_mode, TrayStatus};
use crate::models::record::TimeRecord;
use crate::models::timer::TimerState;
#[cfg(desktop)]
use crate::models::timer::TraySnapshot;
use crate::platform::clock;
use crate::repositories::item as item_repo;
use crate::repositories::record as repo;
use crate::repositories::record_session as session;
use crate::services::countdown::remaining_sec;
use crate::services::settings;

/// 读取当前计时状态（含服务端实时快照）。
pub async fn state(pool: &SqlitePool) -> AppResult<TimerState> {
    let last_item_id = Some(settings::get_last_item_id(pool).await?);
    let Some(active) = session::find_active(pool).await? else {
        return Ok(TimerState::idle(last_item_id));
    };
    let live = live_duration(&active, clock::now_ms());
    let status = if active.running_since.is_some() {
        timer_status::RUNNING
    } else {
        timer_status::PAUSED
    };
    let mode = active.mode.clone();
    let remaining = remaining_sec(&active, live);
    Ok(TimerState {
        status: status.to_string(),
        session: Some(active),
        last_item_id,
        live_duration_sec: live,
        mode,
        remaining_sec: remaining,
    })
}

/// 组装托盘菜单状态快照（ADR-013 §6.e 状态文本口径）。
///
/// 复用调用方已加载的 `TimerState`，避免重复查询（性能：同一轮事件仅查一次状态）。
/// `liveDurationSec` 与 `state()` 同源，额外补充当前会话的事项名。
///
/// 桌面独占：快照只服务托盘菜单，移动端没有托盘（`app::events` 的 `sync_tray` 空实现）。
#[cfg(desktop)]
pub async fn tray_snapshot(pool: &SqlitePool, current: &TimerState) -> AppResult<TraySnapshot> {
    let base = TrayStatus::from_timer_status(&current.status);
    // 倒计时中单独成态（状态行带剩余时长）；暂停中的倒计时仍按「已暂停」呈现（设计稿 §3.3.1）。
    let status = if current.mode == timer_mode::COUNTDOWN && base == TrayStatus::Running {
        TrayStatus::Countdown
    } else {
        base
    };
    // 事项名缺失（如事项已删）落空串，由 `tray_menu` 统一以「未命名」占位（设计稿 §3.3.1）。
    let item_name = match current.session.as_ref() {
        Some(record) => item_repo::find_by_id(pool, record.item_id)
            .await?
            .map(|item| item.name)
            .unwrap_or_default(),
        None => String::new(),
    };
    Ok(TraySnapshot {
        status,
        item_name,
        duration_sec: current.live_duration_sec,
        remaining_sec: current.remaining_sec,
    })
}

/// 开始新会话（无 active 时）。
pub async fn start(pool: &SqlitePool, item_id: Option<i64>) -> AppResult<TimeRecord> {
    if session::find_active(pool).await?.is_some() {
        return Err(AppError::timer_already_running());
    }
    let item_id = item_id.unwrap_or(SYSTEM_ITEM_ID);
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    let now = clock::now_ms();
    let id = session::insert_active(pool, item_id, now).await?;
    // 新会话开始：把墙钟起点钉到单调时刻上，后续「跑了多久」不再看墙钟。
    clock::anchor(now);
    settings::set_last_item_id(pool, item_id).await?;
    /* [V0.4.1] 起停是排查「计时怎么少了 / 多了一段」的唯一现场：只落一行，含事项与
    开始时刻。日志总量按「每次用户动作一行」增长，不影响体积（见 platform::log）。 */
    crate::log_info!("timer start: item={item_id} at={now}");
    reload(pool, id).await
}

/// 暂停：冻结累计，running_since=null。已暂停为幂等 no-op。
pub async fn pause(pool: &SqlitePool) -> AppResult<TimeRecord> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = clock::now_ms();
    if let Some(running_since) = active.running_since {
        let accumulated = active.accumulated_sec + floor_sec(elapsed_ms(running_since, now));
        session::set_accum_and_running(pool, active.id, accumulated, None, now).await?;
        // 暂停后不再有「运行中区间」，锚点必须清掉，否则下次 resume 会拿旧锚点算差值。
        clock::clear_anchor(running_since);
    }
    reload(pool, active.id).await
}

/// 继续：running_since=now。已运行为幂等 no-op。
pub async fn resume(pool: &SqlitePool) -> AppResult<TimeRecord> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = clock::now_ms();
    if active.running_since.is_none() {
        session::set_accum_and_running(pool, active.id, active.accumulated_sec, Some(now), now)
            .await?;
        clock::anchor(now);
    }
    reload(pool, active.id).await
}

/// 丢弃当前会话：直接软删除，不触发待办联动。
pub async fn discard(pool: &SqlitePool) -> AppResult<()> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = clock::now_ms();
    /* 丢弃也把真实累计写进去：软删除的行不该留 `accumulated_sec=0` 的脏值。 */
    let accumulated = live_duration(&active, now);
    let out = session::discard(pool, active.id, accumulated, now, now).await;
    if let Some(rs) = active.running_since {
        clock::clear_anchor(rs);
    }
    out
}

/// 撤销结束：saved 回滚为 active（3s 窗口内，且当前无其他 active）。
pub async fn undo(pool: &SqlitePool, record_id: i64) -> AppResult<TimeRecord> {
    let record = repo::find_by_id(pool, record_id)
        .await?
        .ok_or_else(AppError::timer_no_undo)?;
    if record.status != record_status::SAVED {
        return Err(AppError::timer_no_undo());
    }
    let ended_at = record.ended_at.ok_or_else(AppError::timer_no_undo)?;
    let now = clock::now_ms();
    if now - ended_at > UNDO_WINDOW_MS + UNDO_TOLERANCE_MS {
        return Err(AppError::timer_no_undo());
    }
    if session::find_active(pool).await?.is_some() {
        return Err(AppError::timer_already_running());
    }
    session::reactivate(pool, record_id, now, now).await?;
    reload(pool, record_id).await
}

/// 计时中换事项：分段（end_and_start）或仅改归属（just_switch）。
///
/// [V0.3.4] 分段同样过「最短记录时长」：换事项是顺手动作，旧段只有几秒就是误触级的，
/// 它不该出现在记录列表里。判定与手动结束同一个函数（`timer_stop::should_ignore`），
/// 但**切换本身不能因此中断**——旧段被丢弃时新会话照常开始（ADR-023）。
pub async fn switch(pool: &SqlitePool, item_id: i64, mode: SwitchMode) -> AppResult<TimerState> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    if mode == SwitchMode::EndAndStart && active.running_since.is_some() {
        return Err(AppError::timer_already_running());
    }
    let now = clock::now_ms();
    match mode {
        SwitchMode::JustSwitch => {
            session::set_item_id(pool, active.id, item_id, now).await?;
        }
        SwitchMode::EndAndStart => {
            if now < active.started_at {
                return Err(AppError::invalid_duration());
            }
            let accumulated = live_duration(&active, now);
            // 与手动结束同一口径，见 ADR-023。
            let discard_old = should_ignore(pool, accumulated).await;
            /* [V0.11.3] 旧段跨了零点：先按天拆成多条保存，再开新会话。
            拆开保存与「开会话」是两次写，不是同一个事务——但顺序是安全的：
            旧段先老实落库，新会话失败也只是「切换没成功」，用户再点一次即可，
            不会出现「旧段没了、新段也没开」的半截状态。 */
            if !discard_old
                && crate::services::timer_split::split_by_day(active.started_at, now, accumulated)
                    .len()
                    > 1
            {
                crate::services::timer_split::finalize(pool, &active, accumulated, now, now)
                    .await?;
                start(pool, Some(item_id)).await?;
                clock::anchor(now);
            } else {
                session::end_and_start(
                    pool,
                    active.id,
                    item_id,
                    accumulated,
                    now,
                    now,
                    discard_old,
                )
                .await?;
                // 新会话的墙钟起点是 now，重新锚定（旧锚点属于上一段会话）。
                clock::anchor(now);
            }
        }
    }
    settings::set_last_item_id(pool, item_id).await?;
    crate::log_info!("timer switch: item={item_id} mode={mode:?} at={now}");
    state(pool).await
}

/* [V0.11.24] 崩溃恢复（含边界②多条 active 收尾）移到 `services/timer_recover.rs`，
在此 re-export：`services::timer::resolve_open` 的对外路径不变（commands / app/tray.rs /
测试的调用点都不用动）。托盘退出的 `close_active_for_quit` 只有一个调用点，直接走
`services::timer_recover::` 全路径（app/tray_quit.rs ② 位），不做二次转发。 */
pub use crate::services::timer_recover::resolve_open;

/* [V0.11.2] 周期落盘移到 `services/timer_flush.rs`：跨进程让路的判据与理由太长，
留在本文件会破 300 行。沿用 timer_time / timer_stop 的老路子在此 re-export，
`services::timer::flush_active` 的对外路径不变。 */
pub use crate::services::timer_flush::flush_active;

/* 时间口径（live_duration / elapsed_ms / floor_sec）已移到 `services/timer_time.rs`
并在此 re-export——调用点写法不变，但单文件回到 300 行内。 */
pub(crate) use crate::services::timer_time::{elapsed_ms, floor_sec, live_duration};

/* [V0.3.4] 手动结束（含「最短记录时长」判定）移到 `services/timer_stop.rs`，同样在此
re-export：`services::timer::stop` 的对外路径不变。`should_ignore` 是阈值判定的唯一入口，
`switch` 的分段也用它（ADR-023）。 */
pub use crate::services::timer_stop::{should_ignore, stop};

pub(crate) async fn reload(pool: &SqlitePool, id: i64) -> AppResult<TimeRecord> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(|| AppError::db("记录写入后读取失败"))
}
