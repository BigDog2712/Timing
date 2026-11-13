//! 待办业务：标题校验、排序、软删除、完成态切换。
//!
//! 契约来源：`ARCHITECTURE-V0.2.0 §5 待办 todo(5)`。空标题 → `ITEM_NAME_EMPTY`；
//! 缺 id → `TODO_NOT_FOUND`；`todo_delete` 幂等（不存在静默成功）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::models::constants::TODO_TITLE_MAX_LEN;
use crate::models::todo::{Todo, TodoCreateInput, TodoListParams, TodoPatch};
use crate::platform::clock::now_ms;
use crate::repositories::todo as repo;

/// 批量上限（设计 §3.2 `MAX_BATCH = 60`；前端 `TODO_BATCH_MAX` 同值先拦）
const TODO_BATCH_MAX: usize = 60;

pub async fn list(pool: &SqlitePool, params: TodoListParams) -> AppResult<Vec<Todo>> {
    repo::list(pool, &params).await
}

/// 新建待办。
///
/// [V0.11.3] `item_id` 可显式指定；不指定时**按标题试着匹配一次已有事项**——
/// 用户写「写周报」而这个事项已经存在，那就直接绑上，不必等他开始计时才发现。
/// 匹配不到就留空（不凭空造事项：一条还没开始的待办不该污染事项列表），
/// 由 `todo_start` 在第一次开始时兜底并回填。
pub async fn create(
    pool: &SqlitePool,
    title: &str,
    item_id: Option<i64>,
    planned_at: Option<i64>,
    remind_at: Option<i64>,
) -> AppResult<Todo> {
    let title = normalize_title(title)?;
    let bound = match item_id {
        Some(explicit) => crate::repositories::item::find_by_id(pool, explicit)
            .await?
            .map(|item| item.id),
        None => crate::repositories::item::find_by_name(pool, &title)
            .await?
            .map(|item| item.id),
    };
    let now = now_ms();
    let sort_order = repo::max_sort_order(pool).await? + 1;
    let id = repo::insert(pool, &title, bound, planned_at, remind_at, sort_order, now).await?;
    fetch_or_not_found(pool, id).await
}

/// 批量新建（[0.13 · 1.7]，`todo_create_batch`）：**单事务**插入 1..=60 行。
///
/// 原子语义（设计 §3.2）：任一条校验失败（空标题 → `ITEM_NAME_EMPTY`、超长 →
/// `ITEM_NAME_TOO_LONG`）整批回滚，库里 0 行新增 —— 前端循环调 `todo_create`
/// 会出现"只加了一半"的部分成功，而"统一添加"的动作语义就是原子。
///
/// 实现口径：
///   · **先全部校验，再开事务**：非法输入连库都不碰（失败路径零副作用）；
///   · `sort_order` 取一次 `max+1` 后在事务内本地递增（N 条查询 max 会互相踩）；
///   · 事项绑定与 `create` 同一条规则：按标题匹配一次，匹配不到留空；
///   · 事务体沿用 sqlx 的 drop-rollback：`tx` 在错误路径上被丢弃即回滚。
pub async fn create_batch(pool: &SqlitePool, inputs: Vec<TodoCreateInput>) -> AppResult<Vec<Todo>> {
    /* 1..=60（设计 §3.2 `MAX_BATCH`；前端 `TODO_BATCH_MAX` 同值先拦）。
       这里是防御分支：走不到，走到了说明契约被改坏 —— 用 `DB_ERROR` 报内部不变式。 */
    if inputs.is_empty() || inputs.len() > TODO_BATCH_MAX {
        return Err(AppError::db("批量条数须在 1–60 之间"));
    }
    let normalized: Vec<(String, Option<i64>, Option<i64>)> = inputs
        .iter()
        .map(|input| {
            Ok::<_, AppError>((normalize_title(&input.title)?, input.planned_at, input.remind_at))
        })
        .collect::<AppResult<_>>()?;

    let mut tx = pool.begin().await?;
    let mut sort_order = repo::max_sort_order(&mut *tx).await?;
    let mut created: Vec<Todo> = Vec::with_capacity(normalized.len());
    for (title, planned_at, remind_at) in &normalized {
        let bound = crate::repositories::item::find_by_name(&mut *tx, title)
            .await?
            .map(|item| item.id);
        sort_order += 1;
        let id = repo::insert(&mut *tx, title, bound, *planned_at, *remind_at, sort_order, now_ms()).await?;
        created.push(
            repo::find_by_id(&mut *tx, id)
                .await?
                .ok_or_else(|| AppError::db("待办批量写入后读取失败"))?,
        );
    }
    tx.commit().await?;
    Ok(created)
}

pub async fn update(pool: &SqlitePool, id: i64, patch: TodoPatch) -> AppResult<Todo> {
    fetch_or_not_found(pool, id).await?;
    let title = match patch.title.as_deref() {
        Some(raw) => Some(normalize_title(raw)?),
        None => None,
    };
    /* 显式改绑时才校验事项存在；解绑（Some(None)）直接放行。 */
    let item_id = match patch.item_id {
        Some(Some(explicit)) => {
            if crate::repositories::item::find_by_id(pool, explicit)
                .await?
                .is_none()
            {
                return Err(AppError::item_not_found());
            }
            Some(Some(explicit))
        }
        other => other,
    };
    repo::update(
        pool,
        id,
        title.as_deref(),
        item_id,
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
