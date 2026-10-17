//! 倒计时业务（ADR-011）：作为计时状态机的「模式扩展」，到点判定归 Rust。
//!
//! 数据：`time_records.mode='countdown'` + `target_sec`；状态机仍是 idle|running|paused 三态。
//! 到点行为：自动结束为**用户可配开关、默认关闭**（AC-62）；默认仅通知 + 视觉提示。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::clock::now_ms;
use crate::models::constants::{MAX_COUNTDOWN_SEC, SYSTEM_ITEM_ID};
use crate::models::enums::timer_mode;
use crate::models::record::TimeRecord;
use crate::models::timer::CountdownFired;
use crate::repositories::item as item_repo;
use crate::repositories::record_session as session;
use crate::services::settings;
use crate::services::timer;

/// 开始倒计时会话。非法 `target_sec`（≤0 或 >24h）→ `INVALID_TARGET_SEC`。
pub async fn start(
    pool: &SqlitePool,
    item_id: Option<i64>,
    target_sec: i64,
) -> AppResult<TimeRecord> {
    if target_sec <= 0 || target_sec > MAX_COUNTDOWN_SEC {
        return Err(AppError::invalid_target_sec());
    }
    if session::find_active(pool).await?.is_some() {
        return Err(AppError::timer_already_running());
    }
    let item_id = item_id.unwrap_or(SYSTEM_ITEM_ID);
    if item_repo::find_by_id(pool, item_id).await?.is_none() {
        return Err(AppError::item_not_found());
    }
    let now = now_ms();
    let id = session::insert_active_countdown(pool, item_id, target_sec, now).await?;
    settings::set_last_item_id(pool, item_id).await?;
    timer::reload(pool, id).await
}

/// 1s watcher 调用：若存在「已到点」的倒计时会话则返回其快照（否则 `None`）。
///
/// - 自动结束开关**开** → 结束会话（`saved`，`accumulated_sec` 钳到 target，
///   `ended_at = started_at + target_sec*1000`）；
/// - 开关**关**（AC-62 默认）→ 不改动会话（仍 `active`），通知与事件由调用方发出。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<CountdownFired>> {
    let Some(active) = session::find_active(pool).await? else {
        return Ok(None);
    };
    if active.mode != timer_mode::COUNTDOWN {
        return Ok(None);
    }
    let Some(target_sec) = active.target_sec else {
        return Ok(None);
    };
    let now = now_ms();
    if timer::live_duration(&active, now) < target_sec {
        return Ok(None);
    }
    let item_name = item_repo::find_by_id(pool, active.item_id)
        .await?
        .map(|item| item.name)
        .unwrap_or_default();
    let (record, ended) = if settings::countdown_auto_end(pool).await? {
        let ended_at = active.started_at + target_sec * 1000;
        session::finalize(pool, active.id, target_sec, ended_at, now).await?;
        (timer::reload(pool, active.id).await?, true)
    } else {
        (active, false)
    };
    Ok(Some(CountdownFired {
        record,
        target_sec,
        item_name,
        ended,
    }))
}

/// 倒计时剩余秒数（服务端快照，与 `liveDurationSec` 同源，避免同步跳变）。
/// countup / 无 target → `None`。
pub fn remaining_sec(record: &TimeRecord, live: i64) -> Option<i64> {
    if record.mode != timer_mode::COUNTDOWN {
        return None;
    }
    record.target_sec.map(|target| (target - live).max(0))
}
