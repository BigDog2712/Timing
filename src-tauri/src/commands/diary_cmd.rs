//! 今日日记命令：只做参数转发。

use tauri::State;

use crate::error::AppResult;
use crate::models::diary::{DiaryConfig, TodayDiary};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn diary_get_config(state: State<'_, AppState>) -> AppResult<DiaryConfig> {
    services::diary::get_config(&state.pool).await
}

#[tauri::command]
pub async fn diary_set_config(
    state: State<'_, AppState>,
    config: DiaryConfig,
) -> AppResult<DiaryConfig> {
    services::diary::set_config(&state.pool, config).await
}

#[tauri::command]
pub async fn diary_today(state: State<'_, AppState>) -> AppResult<TodayDiary> {
    services::diary::today(&state.pool).await
}

#[tauri::command]
pub async fn diary_open_today(state: State<'_, AppState>) -> AppResult<TodayDiary> {
    services::diary::open_today(&state.pool).await
}
