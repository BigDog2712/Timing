//! 提醒仓库（`items` / `todos` 的 `remind_at` / `reminded_at`）。仅 SQL + 行映射。
//!
//! 表名与标题列由 `ReminderTarget`（枚举，非用户输入）决定；值一律参数化绑定。

use sqlx::{QueryBuilder, Sqlite, SqlitePool};

use crate::error::AppResult;
use crate::models::reminder::{Reminder, ReminderTarget};

/// UNION 查询行（含目标类型字符串，需再解析为枚举）。
#[derive(sqlx::FromRow)]
struct ReminderRow {
    target: String,
    target_id: i64,
    title: String,
    remind_at: i64,
}

impl ReminderRow {
    fn into_reminder(self) -> Reminder {
        Reminder {
            target: if self.target == "todo" {
                ReminderTarget::Todo
            } else {
                ReminderTarget::Item
            },
            target_id: self.target_id,
            title: self.title,
            remind_at: self.remind_at,
        }
    }
}

/// 目标标题（事项名 / 待办标题）；不存在返回 `None`。
pub async fn title(
    pool: &SqlitePool,
    target: ReminderTarget,
    id: i64,
) -> AppResult<Option<String>> {
    let sql = format!(
        "SELECT {} FROM {} WHERE id = ? AND deleted_at IS NULL",
        target.title_col(),
        target.table()
    );
    Ok(sqlx::query_scalar(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?)
}

/// 设置提醒：写 `remind_at` 并清 `reminded_at`（重设即复活，K-19）。
pub async fn set_reminder(
    pool: &SqlitePool,
    target: ReminderTarget,
    id: i64,
    remind_at: i64,
    now: i64,
) -> AppResult<()> {
    let sql = format!(
        "UPDATE {} SET remind_at = ?, reminded_at = NULL, updated_at = ? \
         WHERE id = ? AND deleted_at IS NULL",
        target.table()
    );
    sqlx::query(&sql)
        .bind(remind_at)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 清除提醒：`remind_at=NULL, reminded_at=NULL`。
pub async fn clear_reminder(
    pool: &SqlitePool,
    target: ReminderTarget,
    id: i64,
    now: i64,
) -> AppResult<()> {
    let sql = format!(
        "UPDATE {} SET remind_at = NULL, reminded_at = NULL, updated_at = ? \
         WHERE id = ? AND deleted_at IS NULL",
        target.table()
    );
    sqlx::query(&sql).bind(now).bind(id).execute(pool).await?;
    Ok(())
}

/// 未触发提醒列表（`remind_at IS NOT NULL AND reminded_at IS NULL`），按 `remind_at ASC`。
pub async fn pending(pool: &SqlitePool) -> AppResult<Vec<Reminder>> {
    let sql = format!(
        "SELECT 'item' AS target, id AS target_id, {} AS title, remind_at FROM items \
         WHERE deleted_at IS NULL AND remind_at IS NOT NULL AND reminded_at IS NULL \
         UNION ALL \
         SELECT 'todo', id, {}, remind_at FROM todos \
         WHERE deleted_at IS NULL AND remind_at IS NOT NULL AND reminded_at IS NULL \
         ORDER BY remind_at ASC",
        ReminderTarget::Item.title_col(),
        ReminderTarget::Todo.title_col(),
    );
    fetch_reminders(pool, &sql, None).await
}

/// 已到点未触发提醒（`remind_at <= now`），按 `remind_at ASC`（后台扫描用）。
///
/// **只含事项**（V0.3.12 / ADR-030）：待办的 `remind_at` 是「开始时间」，走
/// `jobs::nudge` 的两级提醒链路（T-15 / T-5），不再进通用到点提醒。
pub async fn due(pool: &SqlitePool, now: i64) -> AppResult<Vec<Reminder>> {
    let sql = format!(
        "SELECT 'item' AS target, id AS target_id, {} AS title, remind_at FROM items \
         WHERE deleted_at IS NULL AND remind_at IS NOT NULL AND reminded_at IS NULL AND remind_at <= ? \
         ORDER BY remind_at ASC",
        ReminderTarget::Item.title_col(),
    );
    fetch_reminders(pool, &sql, Some(now)).await
}

/// 批量置位 `reminded_at`（先置位再去重，K-19）。
pub async fn mark_fired(pool: &SqlitePool, rows: &[Reminder], now: i64) -> AppResult<()> {
    mark(pool, rows, ReminderTarget::Item, Some(now)).await?;
    mark(pool, rows, ReminderTarget::Todo, Some(now)).await
}

/// 批量回滚 `reminded_at`（通知失败时保留下次重试）。
pub async fn reset_fired(pool: &SqlitePool, rows: &[Reminder]) -> AppResult<()> {
    mark(pool, rows, ReminderTarget::Item, None).await?;
    mark(pool, rows, ReminderTarget::Todo, None).await
}

async fn mark(
    pool: &SqlitePool,
    rows: &[Reminder],
    target: ReminderTarget,
    value: Option<i64>,
) -> AppResult<()> {
    let ids: Vec<i64> = rows
        .iter()
        .filter(|r| r.target == target)
        .map(|r| r.target_id)
        .collect();
    if ids.is_empty() {
        return Ok(());
    }
    let mut qb =
        QueryBuilder::<Sqlite>::new(format!("UPDATE {} SET reminded_at = ", target.table()));
    qb.push_bind(value);
    qb.push(" WHERE id IN (");
    {
        let mut sep = qb.separated(", ");
        for id in &ids {
            sep.push_bind(*id);
        }
    }
    qb.push(")");
    qb.build().execute(pool).await?;
    Ok(())
}

/// 执行 UNION 查询并把行映射为 `Reminder`。
async fn fetch_reminders(
    pool: &SqlitePool,
    sql: &str,
    now: Option<i64>,
) -> AppResult<Vec<Reminder>> {
    let mut query = sqlx::query_as::<_, ReminderRow>(sql);
    if let Some(v) = now {
        // 单占位符（`due` 只查 items，V0.3.12 起不再 UNION todos）
        query = query.bind(v);
    }
    let rows = query.fetch_all(pool).await?;
    Ok(rows.into_iter().map(ReminderRow::into_reminder).collect())
}
