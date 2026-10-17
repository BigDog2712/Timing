//! 设置域命令。`autostartEnabled` 一律以注册表实际状态回填。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::infra::{autostart, events, window};
use crate::models::settings::{ReferenceSettings, ReferenceSettingsPatch, Settings, SettingsPatch};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn get_reference_settings(state: State<'_, AppState>) -> AppResult<ReferenceSettings> {
    services::settings::get_reference(&state.pool).await
}

#[tauri::command]
pub async fn update_reference_settings(
    state: State<'_, AppState>,
    patch: ReferenceSettingsPatch,
) -> AppResult<ReferenceSettings> {
    services::settings::update_reference(&state.pool, &patch).await
}

#[tauri::command]
pub async fn get_settings(app: AppHandle, state: State<'_, AppState>) -> AppResult<Settings> {
    let mut settings = services::settings::get(&state.pool).await?;
    settings.autostart_enabled = autostart::is_enabled(&app)?;
    Ok(settings)
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    // 联动：alwaysOnTop 即时应用到窗口；autostart 即时写注册表。
    if let Some(enabled) = patch.always_on_top {
        window::set_always_on_top(&app, enabled)?;
    }
    if let Some(enabled) = patch.autostart_enabled {
        autostart::set_enabled(&app, enabled)?;
    }
    let mut settings = services::settings::update(&state.pool, &patch).await?;
    settings.autostart_enabled = autostart::is_enabled(&app)?;
    // 主题相关字段变更 → 广播 `theme-changed`（所有窗口自订阅，K-21）。
    if patch.touches_theme() {
        events::emit_theme_changed(&app, &state.pool).await;
    }
    Ok(settings)
}

#[tauri::command]
pub async fn set_autostart(
    app: AppHandle,
    state: State<'_, AppState>,
    enabled: bool,
) -> AppResult<bool> {
    autostart::set_enabled(&app, enabled)?;
    let actual = autostart::is_enabled(&app)?;
    services::settings::set_autostart_flag(&state.pool, actual).await?;
    Ok(actual)
}

#[tauri::command]
pub async fn get_autostart(app: AppHandle) -> AppResult<bool> {
    autostart::is_enabled(&app)
}
