//! 多窗口域命令（V0.2.0 / ADR-009）。含设置面板、事项窗口与便利贴窗口。
//!
//! 仅做「反序列化 -> 调 service/infra -> 返回」，无业务、无 SQL。

use tauri::{AppHandle, State};

use crate::app::events;
use crate::error::AppResult;
use crate::infra::window;
use crate::services;
use crate::state::AppState;

/// 打开 / 聚焦设置面板（单例；已存在则前置聚焦，不重复创建）。
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> AppResult<()> {
    window::open_settings_window(&app)
}

/// 打开 / 聚焦事项窗口（单例；label `todos`）。
#[tauri::command]
pub async fn open_todos_window(app: AppHandle) -> AppResult<()> {
    window::open_todos_window(&app)
}

/// 打开 / 聚焦只读计时器窗口（单例；label `timer`）。
#[tauri::command]
pub async fn open_timer_window(app: AppHandle) -> AppResult<()> {
    window::open_timer_window(&app)
}

/// 打开 / 聚焦便利贴窗口（动态 label `note-{id}`；超上限 → `WINDOW_LIMIT_EXCEEDED`）。
#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let note = services::note::open_guard(&state.pool, note_id).await?;
    window::open_note_window(&app, &note)?;
    events::emit_note_window(&app, true, note_id);
    Ok(())
}

/// 收纳便利贴窗口：落盘几何 + 置 `is_open=0` + 销毁窗口 + emit `note-window-closed`。
#[tauri::command]
pub async fn close_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let geometry = window::note_geometry(&app, note_id);
    services::note::close(&state.pool, note_id, geometry).await?;
    window::close_note_window(&app, note_id)?;
    events::emit_note_window(&app, false, note_id);
    Ok(())
}
