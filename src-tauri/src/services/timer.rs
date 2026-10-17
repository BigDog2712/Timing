//! 计时业务（单一事实来源）：状态机、单调累加、撤销窗口、崩溃恢复、周期落盘。
//!
//! 时间口径（IPC-CONTRACT-v2 §1/§4/R-4）：
//!   实时累计 = accumulated_sec + floor((now - running_since)/1000)，now 为墙钟毫秒。
//!   周期落盘把已计秒数折入 accumulated_sec 并推进 running_since，公式恒等，避免跳变。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::clock::now_ms;
use crate::models::constants::{SYSTEM_ITEM_ID, UNDO_TOLERANCE_MS, UNDO_WINDOW_MS};
use crate::models::enums::{
    record_status, timer_mode, timer_status, ResolveAction, SwitchMode, TrayStatus,
};
use crate::models::record::TimeRecord;
use crate::models::timer::{TimerState, TraySnapshot};
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
    let live = live_duration(&active, now_ms());
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
    let now = now_ms();
    let id = session::insert_active(pool, item_id, now).await?;
    settings::set_last_item_id(pool, item_id).await?;
    reload(pool, id).await
}

/// 暂停：冻结累计，running_since=null。已暂停为幂等 no-op。
pub async fn pause(pool: &SqlitePool) -> AppResult<TimeRecord> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = now_ms();
    if let Some(running_since) = active.running_since {
        let accumulated = active.accumulated_sec + floor_sec(now - running_since);
        session::set_accum_and_running(pool, active.id, accumulated, None, now).await?;
    }
    reload(pool, active.id).await
}

/// 继续：running_since=now。已运行为幂等 no-op。
pub async fn resume(pool: &SqlitePool) -> AppResult<TimeRecord> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = now_ms();
    if active.running_since.is_none() {
        session::set_accum_and_running(pool, active.id, active.accumulated_sec, Some(now), now)
            .await?;
    }
    reload(pool, active.id).await
}

/// 结束并保存（右键单击）：直接置 saved。
pub async fn stop(pool: &SqlitePool) -> AppResult<TimeRecord> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = now_ms();
    if now < active.started_at {
        return Err(AppError::invalid_duration());
    }
    let accumulated = live_duration(&active, now);
    session::finalize(pool, active.id, accumulated, now, now).await?;
    reload(pool, active.id).await
}

/// 丢弃当前会话：直接软删除，不触发待办联动。
pub async fn discard(pool: &SqlitePool) -> AppResult<()> {
    let active = session::find_active(pool)
        .await?
        .ok_or_else(AppError::timer_not_running)?;
    let now = now_ms();
    session::discard(pool, active.id, now, now).await
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
    let now = now_ms();
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
    let now = now_ms();
    match mode {
        SwitchMode::JustSwitch => {
            session::set_item_id(pool, active.id, item_id, now).await?;
        }
        SwitchMode::EndAndStart => {
            if now < active.started_at {
                return Err(AppError::invalid_duration());
            }
            let accumulated = live_duration(&active, now);
            session::end_and_start(pool, active.id, item_id, accumulated, now, now).await?;
        }
    }
    settings::set_last_item_id(pool, item_id).await?;
    state(pool).await
}

/// 崩溃恢复：处理启动时发现的 active 会话。
pub async fn resolve_open(
    pool: &SqlitePool,
    action: ResolveAction,
    end_at: Option<i64>,
) -> AppResult<Option<TimeRecord>> {
    let Some(active) = session::find_active(pool).await? else {
        return Ok(None);
    };
    let now = now_ms();
    match action {
        ResolveAction::Resume => {
            // 重置 running_since=now：不把崩溃停机时长计入（R-2）。
            session::set_accum_and_running(pool, active.id, active.accumulated_sec, Some(now), now)
                .await?;
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Close => {
            let ended = end_at.unwrap_or(now);
            if ended < active.started_at {
                return Err(AppError::invalid_duration());
            }
            // 以最后落盘 accumulated_sec 为准，不补算崩溃间隙（R-2）。
            session::finalize(pool, active.id, active.accumulated_sec, ended, now).await?;
            repo::find_by_id(pool, active.id).await
        }
        ResolveAction::Discard => {
            // 必须置 saved + 软删除，释放 uq_records_open 唯一槽（R-5）。
            session::discard(pool, active.id, now, now).await?;
            Ok(None)
        }
    }
}

/// 周期落盘：把运行中会话的已计秒数折入 accumulated_sec 并推进 running_since。
pub async fn flush_active(pool: &SqlitePool) -> AppResult<()> {
    let Some(active) = session::find_active(pool).await? else {
        return Ok(());
    };
    let Some(running_since) = active.running_since else {
        return Ok(());
    };
    let now = now_ms();
    let delta = floor_sec(now - running_since);
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
    .await
}

pub(crate) fn live_duration(record: &TimeRecord, now: i64) -> i64 {
    match record.running_since {
        Some(running_since) => record.accumulated_sec + floor_sec(now - running_since),
        None => record.accumulated_sec,
    }
}

fn floor_sec(delta_ms: i64) -> i64 {
    if delta_ms <= 0 {
        0
    } else {
        delta_ms / 1000
    }
}

pub(crate) async fn reload(pool: &SqlitePool, id: i64) -> AppResult<TimeRecord> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(|| AppError::db("记录写入后读取失败"))
}
