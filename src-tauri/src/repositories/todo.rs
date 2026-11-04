//! 待办仓库（`todos` 表）。仅 SQL + 行映射，不含业务规则。

use sqlx::{QueryBuilder, Sqlite, SqlitePool, Transaction};

use crate::error::AppResult;
use crate::models::todo::{Todo, TodoListParams};

const COLS: &str = "id, title, planned_at, remind_at, reminded_at, done_at, sort_order, \
                    created_at, updated_at";

/// 按 id 查询（排除已软删除）。
pub async fn find_by_id(pool: &SqlitePool, id: i64) -> AppResult<Option<Todo>> {
    let sql = format!("SELECT {COLS} FROM todos WHERE id = ? AND deleted_at IS NULL");
    let todo = sqlx::query_as::<_, Todo>(&sql)
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(todo)
}

/// 列表。默认排除已完成；`from <= planned_at < to`；排序 `sort_order ASC, planned_at ASC`。
///
/// 传了 `from`/`to` 时只保留 `planned_at` 非空的行（与契约「作用于 planned_at」一致）。
pub async fn list(pool: &SqlitePool, params: &TodoListParams) -> AppResult<Vec<Todo>> {
    let mut qb =
        QueryBuilder::<Sqlite>::new(format!("SELECT {COLS} FROM todos WHERE deleted_at IS NULL"));
    if !params.include_done {
        qb.push(" AND done_at IS NULL");
    }
    if let Some(from) = params.from {
        qb.push(" AND planned_at IS NOT NULL AND planned_at >= ")
            .push_bind(from);
    }
    if let Some(to) = params.to {
        qb.push(" AND planned_at IS NOT NULL AND planned_at < ")
            .push_bind(to);
    }
    qb.push(" ORDER BY sort_order ASC, planned_at ASC");
    let todos = qb.build_query_as::<Todo>().fetch_all(pool).await?;
    Ok(todos)
}

/// 当前最大 sort_order（仅未软删行；无记录返回 0）。
pub async fn max_sort_order(pool: &SqlitePool) -> AppResult<i64> {
    let value: i64 = sqlx::query_scalar(
        "SELECT COALESCE(MAX(sort_order), 0) FROM todos WHERE deleted_at IS NULL",
    )
    .fetch_one(pool)
    .await?;
    Ok(value)
}

/// 插入并返回新 id（`updated_at` = 创建时刻，与 items 同法）。
pub async fn insert(
    pool: &SqlitePool,
    title: &str,
    planned_at: Option<i64>,
    remind_at: Option<i64>,
    sort_order: i64,
    now: i64,
) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO todos \
         (title, planned_at, remind_at, reminded_at, done_at, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, NULL, NULL, ?, ?, ?) RETURNING id",
    )
    .bind(title)
    .bind(planned_at)
    .bind(remind_at)
    .bind(sort_order)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// 部分更新。
///
/// `planned_at` / `remind_at` 三态：`Some(Some(v))` 改值、`Some(None)` 置 NULL、`None` 不动。
/// 任一 `remind_at` 改动都清 `reminded_at`（重设提醒使提醒复活，K-19）**并把 `remind_stage` 归零**
/// —— 改了开始时间，两级提醒（T-15 / T-5）就得按新时刻重来（ADR-030）。
#[allow(clippy::too_many_arguments)]
pub async fn update(
    pool: &SqlitePool,
    id: i64,
    title: Option<&str>,
    planned_at: Option<Option<i64>>,
    remind_at: Option<Option<i64>>,
    sort_order: Option<i64>,
    auto_start: Option<bool>,
    now: i64,
) -> AppResult<()> {
    let mut qb = QueryBuilder::<Sqlite>::new("UPDATE todos SET updated_at = ");
    qb.push_bind(now);
    if let Some(v) = title {
        qb.push(", title = ").push_bind(v.to_string());
    }
    match planned_at {
        Some(Some(v)) => {
            qb.push(", planned_at = ").push_bind(v);
        }
        Some(None) => {
            qb.push(", planned_at = NULL");
        }
        None => {}
    }
    match remind_at {
        Some(Some(v)) => {
            qb.push(", remind_at = ").push_bind(v);
            qb.push(", reminded_at = NULL");
            qb.push(", remind_stage = 0");
        }
        Some(None) => {
            qb.push(", remind_at = NULL");
            qb.push(", reminded_at = NULL");
            qb.push(", remind_stage = 0");
        }
        None => {}
    }
    if let Some(v) = sort_order {
        qb.push(", sort_order = ").push_bind(v);
    }
    if let Some(v) = auto_start {
        qb.push(", auto_start = ").push_bind(i64::from(v));
    }
    qb.push(" WHERE id = ")
        .push_bind(id)
        .push(" AND deleted_at IS NULL");
    qb.build().execute(pool).await?;
    Ok(())
}

/// 设置完成态（`done_at` = Some(now) 完成 / None 取消完成）。
pub async fn set_done(pool: &SqlitePool, id: i64, done_at: Option<i64>, now: i64) -> AppResult<()> {
    sqlx::query("UPDATE todos SET done_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL")
        .bind(done_at)
        .bind(now)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

/// 已保存记录的同名未完成待办：与记录保存共用事务，精确匹配所有重复标题。
/// 不恢复历史软删行，也不触碰已完成待办。
pub(crate) async fn soft_delete_for_saved_record(
    tx: &mut Transaction<'_, Sqlite>,
    record_id: i64,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE todos SET deleted_at = ?, updated_at = ? \
         WHERE deleted_at IS NULL AND done_at IS NULL AND title COLLATE BINARY = (\
           SELECT items.name FROM time_records JOIN items ON items.id = time_records.item_id \
           WHERE time_records.id = ? AND time_records.status = 'saved' \
             AND time_records.deleted_at IS NULL)",
    )
    .bind(now)
    .bind(now)
    .bind(record_id)
    .execute(&mut **tx)
    .await?;
    Ok(())
}

/// 软删除（置 `deleted_at` / `updated_at`）。
pub async fn soft_delete(pool: &SqlitePool, id: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE todos SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}
