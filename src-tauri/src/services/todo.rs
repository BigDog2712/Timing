//! 待办业务：标题校验、排序、软删除、完成态切换。
//!
//! 契约来源：`ARCHITECTURE-V0.2.0 §5 待办 todo(5)`。空标题 → `ITEM_NAME_EMPTY`；
//! 缺 id → `TODO_NOT_FOUND`；`todo_delete` 幂等（不存在静默成功）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::models::constants::TODO_TITLE_MAX_LEN;
use crate::models::todo::{Todo, TodoListParams, TodoPatch};
use crate::platform::clock::now_ms;
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
        patch.auto_start,
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

/// 过期清理（V0.3.15 / ADR-032）：截止时间早于「今天 00:00」且未完成的待办一律软删除。
///
/// 与「待办区只显示今天」共用同一条自然日边界 —— 今天已经看不到的待办，就不留着了；
/// 删的是软删（`deleted_at`），库里仍可追溯，前端也还有撤销条之外的历史记录路径。
/// 调用方是 15s 的 `jobs::nudge`，因此跨零点后最多 15s 内清干净；应用没开则下次启动补齐。
pub async fn purge_overdue(pool: &SqlitePool, today_start: i64) -> AppResult<u64> {
    crate::repositories::todo_nudge::soft_delete_overdue_before(pool, today_start, now_ms()).await
}

/// trim + 非空 + 长度上限校验。
///
/// 空标题 → `ITEM_NAME_EMPTY`（契约）；超长 → `ITEM_NAME_TOO_LONG`（ADR-018）。
/// 绝不静默截断入库。
fn normalize_title(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::new(ErrorCode::ItemNameEmpty, "待办标题不能为空"));
    }
    if trimmed.chars().count() > TODO_TITLE_MAX_LEN {
        return Err(AppError::text_too_long("待办标题", TODO_TITLE_MAX_LEN));
    }
    Ok(trimmed.to_string())
}

async fn fetch_or_not_found(pool: &SqlitePool, id: i64) -> AppResult<Todo> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::todo_not_found)
}
