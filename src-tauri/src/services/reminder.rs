//! 提醒业务：目标存在性校验、设置 / 清除 / 待触发列表；供后台调度复用的批量置位。
//!
//! 契约：`ARCHITECTURE-V0.2.0 §5 提醒 reminder(3)`。目标缺失 → `ITEM_NOT_FOUND` / `TODO_NOT_FOUND`。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::reminder::{Reminder, ReminderTarget};
use crate::platform::clock::now_ms;
use crate::repositories::reminder as repo;

/// 设置提醒（重设清 `reminded_at`，提醒复活，K-19）。
pub async fn set(
    pool: &SqlitePool,
    target: ReminderTarget,
    target_id: i64,
    remind_at: i64,
) -> AppResult<Reminder> {
    let title = require_title(pool, target, target_id).await?;
    repo::set_reminder(pool, target, target_id, remind_at, now_ms()).await?;
    Ok(Reminder {
        target,
        target_id,
        title,
        remind_at,
    })
}

/// 清除提醒。
pub async fn clear(pool: &SqlitePool, target: ReminderTarget, target_id: i64) -> AppResult<()> {
    require_title(pool, target, target_id).await?;
    repo::clear_reminder(pool, target, target_id, now_ms()).await
}

/// 未触发提醒列表（按 `remind_at ASC`）。
pub async fn pending(pool: &SqlitePool) -> AppResult<Vec<Reminder>> {
    repo::pending(pool).await
}

/// 已到点未触发提醒（后台扫描用；`remind_at <= now`）。
pub async fn due(pool: &SqlitePool, now: i64) -> AppResult<Vec<Reminder>> {
    repo::due(pool, now).await
}

/// 批量置位 `reminded_at`（先置位再去重，K-19）。
pub async fn mark_fired(pool: &SqlitePool, rows: &[Reminder], now: i64) -> AppResult<()> {
    repo::mark_fired(pool, rows, now).await
}

/// 批量回滚 `reminded_at`（通知失败时保留待重试，绝不静默丢提醒）。
pub async fn reset_fired(pool: &SqlitePool, rows: &[Reminder]) -> AppResult<()> {
    repo::reset_fired(pool, rows).await
}

/// 校验目标存在并返回其标题（事项名 / 待办标题）。
async fn require_title(
    pool: &SqlitePool,
    target: ReminderTarget,
    target_id: i64,
) -> AppResult<String> {
    match repo::title(pool, target, target_id).await? {
        Some(title) => Ok(title),
        None => Err(match target {
            ReminderTarget::Item => AppError::item_not_found(),
            ReminderTarget::Todo => AppError::todo_not_found(),
        }),
    }
}
