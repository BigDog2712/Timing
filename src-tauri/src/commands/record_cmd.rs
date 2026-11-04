//! 记录域命令。

use tauri::State;

use crate::error::AppResult;
use crate::models::common::Paginated;
use crate::models::record::{RecordPatch, TimeRecord};
use crate::models::stats::StatsSummary;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_records(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
    page: Option<i64>,
    limit: Option<i64>,
) -> AppResult<Paginated<TimeRecord>> {
    services::record::list(&state.pool, item_id, from, to, page, limit).await
}

#[tauri::command]
pub async fn stats_summary(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<StatsSummary> {
    services::record::stats(&state.pool, item_id, from, to).await
}

#[tauri::command]
pub async fn update_record(
    state: State<'_, AppState>,
    id: i64,
    patch: RecordPatch,
) -> AppResult<TimeRecord> {
    services::record::update(&state.pool, id, patch).await
}

#[tauri::command]
pub async fn delete_record(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    services::record::delete(&state.pool, id).await
}
