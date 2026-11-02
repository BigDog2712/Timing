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
use crate::models::enums::{
    record_status, timer_mode, timer_status, ResolveAction, SwitchMode, TrayStatus,
};
use crate::models::record::TimeRecord;
use crate::models::timer::{TimerState, TraySnapshot};
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
            session::end_and_start(pool, active.id, item_id, accumulated, now, now, discard_old)
                .await?;
            // 新会话的墙钟起点是 now，重新锚定（旧锚点属于上一段会话）。
            clock::anchor(now);
        }
    }
    settings::set_last_item_id(pool, item_id).await?;
    crate::log_info!("timer switch: item={item_id} mode={mode:?} at={now}");
    state(pool).await
}

/// 崩溃恢复：处理启动时发现的 active 会话。
///
/// `include_gap`（V0.4.2）把「退出期间」并入累计——见 `gap_sec`。默认 false，
/// 即 R-2「应用关着就停表」；勾选后由用户显式承担这段空档。
pub async fn resolve_open(
    pool: &SqlitePool,
    action: ResolveAction,
    end_at: Option<i64>,
    include_gap: bool,
) -> AppResult<Option<TimeRecord>> {
    let Some(active) = session::find_active(pool).await? else {
        return Ok(None);
    };
    let now = clock::now_ms();
    match action {
        ResolveAction::Resume => {
            // 不带 gap 时重置 running_since=now：不把崩溃停机时长计入（R-2）。
            let base = active.accumulated_sec + gap_sec(&active, now, include_gap);
            session::set_accum_and_running(pool, active.id, base, Some(now), now).await?;
            clock::anchor(now);
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Close => {
            let ended = end_at.unwrap_or(now);
            if ended < active.started_at {
                return Err(AppError::invalid_duration());
            }
            // 以最后落盘 accumulated_sec 为准；勾了 include_gap 才补算停机间隙（R-2）。
            let base = active.accumulated_sec + gap_sec(&active, ended, include_gap);
            session::finalize(pool, active.id, base, ended, now).await?;
            if let Some(rs) = active.running_since {
                clock::clear_anchor(rs);
            }
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Discard => {
            // 必须置 saved + 软删除，释放 uq_records_open 唯一槽（R-5）。
            // 累计同样以最后落盘值为准（不补算崩溃间隙，R-2）；记录都不要了，gap 更无从谈起。
            session::discard(pool, active.id, active.accumulated_sec, now, now).await?;
            if let Some(rs) = active.running_since {
                clock::clear_anchor(rs);
            }
            Ok(None)
        }
    }
}

/// 周期落盘：把运行中会话的已计秒数折入 accumulated_sec 并推进 running_since。
///
/// 折账用**单调**差值（锚点存在时），所以系统时钟前跳不会被算进时长；
/// 折完把 `running_since` 推到当前墙钟并**重新锚定**，保证下一段继续单调计量。
pub async fn flush_active(pool: &SqlitePool) -> AppResult<()> {
    let Some(active) = session::find_active(pool).await? else {
        // 无 active 会话：锚点表里不应再有任何有效起点。
        clock::clear_all_anchors();
        return Ok(());
    };
    let Some(running_since) = active.running_since else {
        return Ok(());
    };
    let now = clock::now_ms();
    let delta = floor_sec(elapsed_ms(running_since, now));
    if delta <= 0 {
        return Ok(());
    }
    session::set_accum_and_running(
        pool,
        active.id,
        active.accumulated_sec + delta,
        Some(now),
        now,
    )
    .await?;
    clock::anchor(now);
    Ok(())
}

/* 时间口径（live_duration / elapsed_ms / floor_sec）已移到 `services/timer_time.rs`
并在此 re-export——调用点写法不变，但单文件回到 300 行内。 */
pub(crate) use crate::services::timer_time::{elapsed_ms, floor_sec, gap_sec, live_duration};

/* [V0.3.4] 手动结束（含「最短记录时长」判定）移到 `services/timer_stop.rs`，同样在此
re-export：`services::timer::stop` 的对外路径不变。`should_ignore` 是阈值判定的唯一入口，
`switch` 的分段也用它（ADR-023）。 */
pub use crate::services::timer_stop::{should_ignore, stop};

pub(crate) async fn reload(pool: &SqlitePool, id: i64) -> AppResult<TimeRecord> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(|| AppError::db("记录写入后读取失败"))
}
