//! 待办业务：标题校验、排序、软删除、完成态切换。
//!
//! 契约来源：`ARCHITECTURE-V0.2.0 §5 待办 todo(5)`。空标题 → `ITEM_NAME_EMPTY`；
//! 缺 id → `TODO_NOT_FOUND`；`todo_delete` 幂等（不存在静默成功）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::infra::clock::now_ms;
use crate::models::constants::TODO_TITLE_MAX_LEN;
use crate::models::todo::{Todo, TodoListParams, TodoPatch};
use crate::repositories::todo as repo;

pub async fn list(pool: &SqlitePool, params: TodoListParams) -> AppResult<Vec<Todo>> {
    repo::list(pool, &params).await
}

pub async fn create(
    pool: &SqlitePool,
    title: &str,
    planned_at: Option<i64>,
    remind_at: Option<i64>,
) -> AppResult<Todo> {
    let title = normalize_title(title)?;
    let now = now_ms();
    let sort_order = repo::max_sort_order(pool).await? + 1;
    let id = repo::insert(pool, &title, planned_at, remind_at, sort_order, now).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn update(pool: &SqlitePool, id: i64, patch: TodoPatch) -> AppResult<Todo> {
    fetch_or_not_found(pool, id).await?;
    let title = match patch.title.as_deref() {
        Some(raw) => Some(normalize_title(raw)?),
        None => None,
    };
    repo::update(
        pool,
        id,
        title.as_deref(),
        patch.planned_at,
        patch.remind_at,
        patch.sort_order,
        now_ms(),
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

/// 切换完成态（**显式传 `done`**，不用盲翻转）。状态幂等：同值连调结果稳定。
pub async fn toggle(pool: &SqlitePool, id: i64, done: bool) -> AppResult<Todo> {
    fetch_or_not_found(pool, id).await?;
    let now = now_ms();
    repo::set_done(pool, id, done.then_some(now), now).await?;
    fetch_or_not_found(pool, id).await
}

/// 软删除。**幂等**：目标不存在（或已软删）静默成功（契约 §5:291 / mock 同语义）。
pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    if repo::find_by_id(pool, id).await?.is_none() {
        return Ok(());
    }
    repo::soft_delete(pool, id, now_ms()).await
}

/// trim + 非空 + 长度上限校验。
///
/// 空标题 → `ITEM_NAME_EMPTY`（契约）。超长无专用错误码（错误码集锁定 16 个，不可扩展），
/// 复用 `ITEM_NAME_EMPTY` 并给明确 message，绝不静默截断入库。
fn normalize_title(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(ErrorCode::ItemNameEmpty, "待办标题不能为空"));
    }
    if trimmed.chars().count() > TODO_TITLE_MAX_LEN {
        return Err(AppError::new(
            ErrorCode::ItemNameEmpty,
            format!("待办标题长度不能超过 {TODO_TITLE_MAX_LEN} 字"),
        ));
    }
    Ok(trimmed.to_string())
}

async fn fetch_or_not_found(pool: &SqlitePool, id: i64) -> AppResult<Todo> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::todo_not_found)
}
