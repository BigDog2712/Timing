//! 事项域命令。

use tauri::State;

use crate::error::AppResult;
use crate::models::item::{Item, ItemPatch};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_items(
    state: State<'_, AppState>,
    include_archived: Option<bool>,
) -> AppResult<Vec<Item>> {
    services::item::list(&state.pool, include_archived.unwrap_or(false)).await
}

#[tauri::command]
pub async fn create_item(
    state: State<'_, AppState>,
    name: String,
    color: Option<String>,
) -> AppResult<Item> {
    services::item::create(&state.pool, &name, color).await
}

#[tauri::command]
pub async fn update_item(state: State<'_, AppState>, id: i64, patch: ItemPatch) -> AppResult<Item> {
    services::item::update(&state.pool, id, patch).await
}

#[tauri::command]
pub async fn archive_item(state: State<'_, AppState>, id: i64) -> AppResult<Item> {
    services::item::archive(&state.pool, id).await
}

#[tauri::command]
pub async fn unarchive_item(state: State<'_, AppState>, id: i64) -> AppResult<Item> {
    services::item::unarchive(&state.pool, id).await
}

#[tauri::command]
pub async fn delete_item(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    services::item::delete(&state.pool, id).await
}
