//! 主题域命令（V0.2.0 / IPC-CONTRACT-v2 §5.4）。
//!
//! 变更成功后向**所有窗口**广播 `theme-changed`（K-21：各窗自订阅重渲染）。
//! 仅做「反序列化 -> 调 service -> 事件 -> 返回」，无业务、无 SQL。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::infra::events;
use crate::models::theme::{AccentColors, AccentPatch, ThemeMode, ThemeSettings};
use crate::services;
use crate::state::AppState;

/// 读取主题模式。
#[tauri::command]
pub async fn theme_get(state: State<'_, AppState>) -> AppResult<ThemeSettings> {
    services::theme::settings(&state.pool).await
}

/// 设置主题模式；成功后广播 `theme-changed`。
#[tauri::command]
pub async fn theme_set(
    app: AppHandle,
    state: State<'_, AppState>,
    mode: ThemeMode,
) -> AppResult<ThemeSettings> {
    let mode = services::theme::set_mode(&state.pool, mode).await?;
    events::emit_theme_changed(&app, &state.pool).await;
    Ok(ThemeSettings { mode })
}

/// 读取四色。
#[tauri::command]
pub async fn accent_get(state: State<'_, AppState>) -> AppResult<AccentColors> {
    services::theme::accents(&state.pool).await
}

/// 部分更新四色；非法 hex → `INVALID_COLOR`；成功后广播 `theme-changed`。
#[tauri::command]
pub async fn accent_set(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: AccentPatch,
) -> AppResult<AccentColors> {
    let accents = services::theme::set_accents(&state.pool, &patch).await?;
    events::emit_theme_changed(&app, &state.pool).await;
    Ok(accents)
}
