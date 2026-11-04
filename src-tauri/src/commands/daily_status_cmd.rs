//! Daily completion command DTO adapter.
use crate::{error::AppResult, services::daily_status, state::AppState};
use std::collections::HashMap;
use tauri::State;

#[tauri::command]
pub async fn daily_status_get(
    state: State<'_, AppState>,
    date: String,
) -> AppResult<HashMap<i64, String>> {
    daily_status::get(&state.pool, &date).await
}

#[tauri::command]
pub async fn daily_status_set(
    state: State<'_, AppState>,
    date: String,
    item_id: i64,
    status: String,
) -> AppResult<()> {
    daily_status::set(&state.pool, &date, item_id, &status).await
}
