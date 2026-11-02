//! 事项业务：校验（空名 / 超长）、系统事项保护、排序。
//!
//! **允许同名**（ADR-021，2026-10-18）：事项靠 `id` 区分，名字只是展示，不再做唯一性校验。
//! 名字用 `name_exists` 拦重复会连带把「归档后重建同名」「两条同名但不同色」这类正当需求挡掉，
//! 且「今日计时」已改为同名不同事项拆行，不再依赖名字唯一（见 `src/lib/todayGroups.ts`）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::constants::ITEM_NAME_MAX_LEN;
use crate::models::enums::item_status;
use crate::models::item::{Item, ItemPatch};
use crate::platform::clock::now_ms;
use crate::repositories::item as repo;

pub async fn list(pool: &SqlitePool, include_archived: bool) -> AppResult<Vec<Item>> {
    repo::list(pool, include_archived).await
}

/// 名称校验：trim 后非空且 ≤ `ITEM_NAME_MAX_LEN`。
///
/// 前端两处输入框都限制 60 字（`ItemPicker` / `InlineNameEntry`），后端此前不校验，
/// 绕过 UI 直接调 IPC 可存进任意长名称（托盘会按宽度截断，展示与数据不一致）。
/// V0.3.0 补后端同值校验，超长 → `ITEM_NAME_TOO_LONG`（ADR-018）。
fn normalize_name(raw: &str) -> AppResult<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(AppError::item_name_empty());
    }
    if trimmed.chars().count() > ITEM_NAME_MAX_LEN {
        return Err(AppError::text_too_long("事项名称", ITEM_NAME_MAX_LEN));
    }
    Ok(trimmed.to_string())
}

pub async fn create(pool: &SqlitePool, name: &str, color: Option<String>) -> AppResult<Item> {
    let trimmed = normalize_name(name)?;
    let now = now_ms();
    let sort_order = repo::max_sort_order(pool).await? + 1;
    let normalized = normalize_color(color);
    let id = repo::insert(pool, &trimmed, normalized.as_deref(), sort_order, now).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn update(pool: &SqlitePool, id: i64, patch: ItemPatch) -> AppResult<Item> {
    fetch_or_not_found(pool, id).await?;

    let mut name_to_set: Option<String> = None;
    if let Some(raw) = patch.name.as_ref() {
        name_to_set = Some(normalize_name(raw)?);
    }

    // color：仅当提供非空值时更新（Some("") 视为不修改，MVP 不支持清空）
    let color_to_set = patch
        .color
        .as_deref()
        .map(str::trim)
        .filter(|c| !c.is_empty())
        .map(str::to_string);

    repo::update(
        pool,
        id,
        repo::ItemFields {
            name: name_to_set.as_deref(),
            color: color_to_set.as_deref(),
            sort_order: patch.sort_order,
            remind_at: patch.remind_at,
            is_pinned: patch.is_pinned,
        },
        now_ms(),
    )
    .await?;
    fetch_or_not_found(pool, id).await
}

pub async fn archive(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    let existing = fetch_or_not_found(pool, id).await?;
    if existing.is_system {
        return Err(AppError::item_system_protected());
    }
    repo::set_status(pool, id, item_status::ARCHIVED, now_ms()).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn unarchive(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    fetch_or_not_found(pool, id).await?;
    repo::set_status(pool, id, item_status::ACTIVE, now_ms()).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn delete(pool: &SqlitePool, id: i64) -> AppResult<()> {
    let existing = fetch_or_not_found(pool, id).await?;
    if existing.is_system {
        return Err(AppError::item_system_protected());
    }
    repo::soft_delete(pool, id, now_ms()).await
}

async fn fetch_or_not_found(pool: &SqlitePool, id: i64) -> AppResult<Item> {
    repo::find_by_id(pool, id)
        .await?
        .ok_or_else(AppError::item_not_found)
}

fn normalize_color(color: Option<String>) -> Option<String> {
    color
        .map(|c| c.trim().to_string())
        .filter(|c| !c.is_empty())
}
