//! 事项业务：校验（空名 / 重名）、系统事项保护、排序。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::clock::now_ms;
use crate::models::enums::item_status;
use crate::models::item::{Item, ItemPatch};
use crate::repositories::item as repo;

pub async fn list(pool: &SqlitePool, include_archived: bool) -> AppResult<Vec<Item>> {
    repo::list(pool, include_archived).await
}

pub async fn create(pool: &SqlitePool, name: &str, color: Option<String>) -> AppResult<Item> {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return Err(AppError::item_name_empty());
    }
    if repo::name_exists(pool, trimmed, None).await? {
        return Err(AppError::item_name_duplicate(trimmed));
    }
    let now = now_ms();
    let sort_order = repo::max_sort_order(pool).await? + 1;
    let normalized = normalize_color(color);
    let id = repo::insert(pool, trimmed, normalized.as_deref(), sort_order, now).await?;
    fetch_or_not_found(pool, id).await
}

pub async fn update(pool: &SqlitePool, id: i64, patch: ItemPatch) -> AppResult<Item> {
    fetch_or_not_found(pool, id).await?;

    let mut name_to_set: Option<String> = None;
    if let Some(raw) = patch.name.as_ref() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            return Err(AppError::item_name_empty());
        }
        if repo::name_exists(pool, trimmed, Some(id)).await? {
            return Err(AppError::item_name_duplicate(trimmed));
        }
        name_to_set = Some(trimmed.to_string());
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
    let existing = fetch_or_not_found(pool, id).await?;
    if repo::name_exists(pool, &existing.name, Some(id)).await? {
        return Err(AppError::item_name_duplicate(&existing.name));
    }
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
