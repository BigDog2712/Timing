//! 待办区块专用的同步查询（从 `md_sync.rs` 拆出，守住单文件 ≤300 行）。
//!
//! 为什么单独一份：其余三种同步数据都按「某一天」归属，只有待办是**跨天的池子**
//! ——它没有天然的那一天，取数靠「未完成 + 计划时间不在当天」这条口径。把两套
//! 归属逻辑放在同一个文件里，读的人很容易把「按 started_at 归日」的习惯套过来。

use sqlx::SqlitePool;

use crate::error::AppResult;

/// 待办区块的一行（同步渲染只需要标题与计划时间）。
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TodoForBlock {
    pub id: i64,
    pub title: String,
    pub planned_at: Option<i64>,
}

/// 待办区块的数据源：**未完成**、且计划时间**不在当天**的待办。
///
/// 两个过滤条件都有明确口径（见 `services::md_sync::export::todos`）：
/// - 排除已完成：区块表达「还要做的事」，勾完就该从日记里退场；
/// - 排除当天：今天要执行的属于当天日程，用户会在计时区块里体现它的结果。
///   逾期的（`planned_at` 早于今天）与未排期的（`planned_at IS NULL`）仍然算
///   「以后要做的」，照常列出。
pub async fn todos_for_block(
    pool: &SqlitePool,
    from: i64,
    to: i64,
) -> AppResult<Vec<TodoForBlock>> {
    let rows = sqlx::query_as::<_, TodoForBlock>(
        "SELECT t.id, t.title, t.planned_at FROM todos t \
         WHERE t.deleted_at IS NULL AND t.done_at IS NULL \
           AND (t.planned_at IS NULL OR t.planned_at < ? OR t.planned_at >= ?) \
         ORDER BY (t.planned_at IS NULL) ASC, t.planned_at ASC, t.sort_order ASC, t.id ASC",
    )
    .bind(from)
    .bind(to)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 从 Markdown 改写待办的标题 / 计划时间 / 完成时刻。
pub async fn update_todo_from_sync(
    pool: &SqlitePool,
    id: i64,
    title: &str,
    planned_at: Option<i64>,
    done_at: Option<i64>,
    now: i64,
) -> AppResult<u64> {
    let result = sqlx::query(
        "UPDATE todos SET title = ?, planned_at = ?, done_at = ?, updated_at = ? \
         WHERE id = ? AND deleted_at IS NULL",
    )
    .bind(title)
    .bind(planned_at)
    .bind(done_at)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(result.rows_affected())
}

/// 从 Markdown 新建一条待办（排在现有待办之后）。
pub async fn insert_todo_from_sync(
    pool: &SqlitePool,
    title: &str,
    planned_at: Option<i64>,
    done_at: Option<i64>,
    now: i64,
) -> AppResult<i64> {
    let id = sqlx::query_scalar(
        "INSERT INTO todos \
         (title, planned_at, done_at, sort_order, created_at, updated_at) \
         VALUES (?, ?, ?, \
                 (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM todos WHERE deleted_at IS NULL), \
                 ?, ?) RETURNING id",
    )
    .bind(title)
    .bind(planned_at)
    .bind(done_at)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}
