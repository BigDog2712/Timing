//! 待办提醒链路业务（ADR-030）：两级提醒「该弹谁」+ 阶段推进 + 到点自动开始候选。
//!
//! 两级提醒都以 `todos.remind_at`（= 待办的**开始时间**）为基准：
//!   - `stage = 1` 轻提醒：开始前 15 分钟（`TODO_LIGHT_LEAD_MS`），浮出卡问「要不要改时间」；
//!   - `stage = 2` 自动开始询问：开始前 5 分钟（`TODO_START_LEAD_MS`），问「当前结束后自动开始？」。
//!
//! **阶段只升不降**（`remind_stage` 取 `MAX`）：同一 tick 内先弹 T-15 再弹 T-5 也不会互相覆盖；
//! 改开始时间时 `repositories::todo::update` 会把阶段归零，让两级按新时刻重来。
//! 超过 `TODO_NUDGE_GRACE_MS` 的陈旧待办由 `expire` 静默标成已处理，绝不补弹。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::constants::{TODO_LIGHT_LEAD_MS, TODO_NUDGE_GRACE_MS, TODO_START_LEAD_MS};
use crate::models::nudge::TodoNudge;
use crate::repositories::todo_nudge as repo;

/// 轻提醒（开始前 15 分钟）。
pub const STAGE_LIGHT: i64 = 1;
/// 自动开始询问（开始前 5 分钟）。
pub const STAGE_AUTOSTART: i64 = 2;

/// 某一级该弹的待办（未置位、未完成、未过期）。
pub async fn due(pool: &SqlitePool, stage: i64, now: i64) -> AppResult<Vec<TodoNudge>> {
    let lead = lead_of(stage);
    let rows = repo::nudge_due(pool, stage, lead, TODO_NUDGE_GRACE_MS, now).await?;
    Ok(rows
        .into_iter()
        .map(|r| TodoNudge {
            todo_id: r.id,
            title: r.title,
            remind_at: r.remind_at,
            stage,
        })
        .collect())
}

/// 到点该自动开始的待办（调用方保证**当前空闲**；有会话时由 `stop` 钩子接管）。
pub async fn autostart_due(pool: &SqlitePool, now: i64) -> AppResult<Vec<TodoNudge>> {
    let rows = repo::autostart_due(pool, TODO_NUDGE_GRACE_MS, now).await?;
    Ok(rows
        .into_iter()
        .map(|r| TodoNudge {
            todo_id: r.id,
            title: r.title,
            remind_at: r.remind_at,
            stage: STAGE_AUTOSTART,
        })
        .collect())
}

/// 先置位再弹（与 `jobs::reminder` 同一套「先标记后通知」顺序：崩溃也不会重复弹）。
pub async fn mark(pool: &SqlitePool, due: &[TodoNudge], now: i64) -> AppResult<()> {
    let Some(first) = due.first() else {
        return Ok(());
    };
    let ids: Vec<i64> = due.iter().map(|n| n.todo_id).collect();
    repo::set_remind_stage(pool, &ids, first.stage, now).await
}

/// 静默处理「已经晚太久」的待办（见 `TODO_NUDGE_GRACE_MS`）。
pub async fn expire(pool: &SqlitePool, now: i64) -> AppResult<()> {
    repo::expire_stale(pool, TODO_NUDGE_GRACE_MS, now).await
}

fn lead_of(stage: i64) -> i64 {
    if stage == STAGE_LIGHT {
        TODO_LIGHT_LEAD_MS
    } else {
        TODO_START_LEAD_MS
    }
}
