//! 待办提醒链路的仓库（remind_stage / auto_start / 过期清理）。仅 SQL + 行映射。
//!
//! 从 repositories/todo.rs 拆出（单文件 ≤300 行纪律）：CRUD 与单条软删仍在 todo.rs，
//! 这里只放**扫描类**查询 —— 两级提醒命中、到点自动开始候选、过期批量软删除。

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::error::AppResult;

/// 批量软删除「截止时间早于 `cutoff` 且未完成」的待办（过期自动清理），返回删除条数。
///
/// 只看 `planned_at`（截止 / 承诺时刻）：没有截止时间的待办永远不会「过期」，
/// 与 `pendingTone` 的逾期判定同一口径。已完成的不清 —— 那是当天的成果。
pub async fn soft_delete_overdue_before(
    pool: &SqlitePool,
    cutoff: i64,
    now: i64,
) -> AppResult<u64> {
    let result = sqlx::query(
        "UPDATE todos SET deleted_at = ?, updated_at = ? \
         WHERE deleted_at IS NULL AND done_at IS NULL \
           AND planned_at IS NOT NULL AND planned_at < ?",
    )
    .bind(now)
    .bind(now)
    .bind(cutoff)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/* ------------------------- 提醒链路（V0.3.12 / ADR-030） ------------------------- */

/// 提醒扫描行（仅 id / 标题 / 开始时刻），由 `services::todo_nudge` 组装对外 DTO。
#[derive(sqlx::FromRow)]
pub struct NudgeRow {
    pub id: i64,
    pub title: String,
    pub remind_at: i64,
}

/// 该弹某一级提醒的待办：`remind_at - lead <= now`、阶段未到、且**没早过头**
/// （`remind_at + grace >= now`，关机一夜后不补弹）。
pub async fn nudge_due(
    pool: &SqlitePool,
    stage: i64,
    lead_ms: i64,
    grace_ms: i64,
    now: i64,
) -> AppResult<Vec<NudgeRow>> {
    let rows = sqlx::query_as::<_, NudgeRow>(
        "SELECT id, title, remind_at FROM todos \
         WHERE deleted_at IS NULL AND done_at IS NULL AND remind_at IS NOT NULL \
           AND remind_stage < ? AND remind_at - ? <= ? AND remind_at + ? >= ? \
         ORDER BY remind_at ASC, id ASC",
    )
    .bind(stage)
    .bind(lead_ms)
    .bind(now)
    .bind(grace_ms)
    .bind(now)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 到点该自动开始的待办：两级提醒都已过、`remind_at <= now`，且
/// **要么**用户答应过「结束后自动开始」（`auto_start=1`，已由 `stop` 钩子优先处理，
/// 这里是兜底）**要么**刚到点不久（`remind_at + grace >= now`，防陈旧待办在启动瞬间起计时）。
pub async fn autostart_due(pool: &SqlitePool, grace_ms: i64, now: i64) -> AppResult<Vec<NudgeRow>> {
    let rows = sqlx::query_as::<_, NudgeRow>(
        "SELECT id, title, remind_at FROM todos \
         WHERE deleted_at IS NULL AND done_at IS NULL AND remind_at IS NOT NULL \
           AND remind_stage >= 2 AND remind_at <= ? \
           AND (auto_start = 1 OR remind_at + ? >= ?) \
         ORDER BY remind_at ASC, id ASC",
    )
    .bind(now)
    .bind(grace_ms)
    .bind(now)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 把「已经晚太久」的待办直接标成已处理（stage=2）并撤回「结束后自动开始」的应允：
/// 关机一夜后既不该补弹，也不该在启动瞬间自己起一个计时。
pub async fn expire_stale(pool: &SqlitePool, grace_ms: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE todos SET remind_stage = 2, auto_start = 0, updated_at = ? \
         WHERE deleted_at IS NULL AND done_at IS NULL AND remind_at IS NOT NULL \
           AND remind_at + ? < ?",
    )
    .bind(now)
    .bind(grace_ms)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// 「结束后自动开始」候选：用户答应过（`auto_start=1`）且最早到点的那一条。
pub async fn autostart_pending(pool: &SqlitePool) -> AppResult<Option<NudgeRow>> {
    let row = sqlx::query_as::<_, NudgeRow>(
        "SELECT id, title, remind_at FROM todos \
         WHERE deleted_at IS NULL AND done_at IS NULL AND remind_at IS NOT NULL \
           AND auto_start = 1 \
         ORDER BY remind_at ASC, id ASC LIMIT 1",
    )
    .fetch_optional(pool)
    .await?;
    Ok(row)
}

/// 批量推进提醒阶段（`remind_stage` 只升不降：`MAX(remind_stage, stage)`）。
pub async fn set_remind_stage(
    pool: &SqlitePool,
    ids: &[i64],
    stage: i64,
    now: i64,
) -> AppResult<()> {
    if ids.is_empty() {
        return Ok(());
    }
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE todos SET remind_stage = MAX(remind_stage, ");
    qb.push_bind(stage);
    qb.push("), updated_at = ");
    qb.push_bind(now);
    qb.push(" WHERE id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in ids {
            sep.push_bind(*id);
        }
    }
    qb.push(")");
    qb.build().execute(pool).await?;
    Ok(())
}
