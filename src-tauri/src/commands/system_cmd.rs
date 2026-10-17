//! 窗口 / 系统域命令（含 [P1] 快捷键占位）。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::infra::{shortcuts, window};
use crate::models::enums::ShortcutAction;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn show_window(app: AppHandle) -> AppResult<()> {
    window::show_main(&app)
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> AppResult<()> {
    window::hide_main(&app)
}

#[tauri::command]
pub async fn toggle_window(app: AppHandle) -> AppResult<()> {
    window::toggle(&app)
}

#[tauri::command]
pub async fn set_always_on_top(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<()> {
    window::set_always_on_top(&app, enabled)?;
    services::settings::set_always_on_top(&state.pool, enabled).await
}

#[tauri::command]
pub async fn save_window_position(state: State<'_, AppState>, x: f64, y: f64) -> AppResult<()> {
    services::settings::set_window_position(&state.pool, x, y).await
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}

#[tauri::command]
pub async fn register_shortcut(
    app: AppHandle,
    action: ShortcutAction,
    accelerator: String,
) -> AppResult<bool> {
    shortcuts::register(&app, action, &accelerator)
}
