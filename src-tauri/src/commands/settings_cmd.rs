//! 设置域命令。`autostartEnabled` 一律回填**实际**状态（桌面读注册表，移动端恒 false）。
//!
//! 自启是桌面独占能力（Android 无等价的「开机启动」语义，`BOOT_COMPLETED` 是另一件事）：
//! 两个平台各有一个同名小函数，命令体因此不必逐行 `#[cfg]`，
//! `Settings.autostartEnabled` 字段**保留**（契约零变化），只是移动端永远是 `false`。

use tauri::{AppHandle, State};

use crate::app::events;
use crate::error::AppResult;
#[cfg(desktop)]
use crate::infra::autostart;
use crate::models::settings::{ReferenceSettings, ReferenceSettingsPatch, Settings, SettingsPatch};
use crate::services;
use crate::state::AppState;

/// 自启实际状态。
#[cfg(desktop)]
fn autostart_enabled(app: &AppHandle) -> AppResult<bool> {
    autostart::is_enabled(app)
}

/// 移动端没有开机自启：恒 false（字段保留，前端据此隐藏开关）。
#[cfg(mobile)]
fn autostart_enabled(_app: &AppHandle) -> AppResult<bool> {
    Ok(false)
}

/// 开关自启。
#[cfg(desktop)]
fn set_autostart_enabled(app: &AppHandle, enabled: bool) -> AppResult<()> {
    autostart::set_enabled(app, enabled)
}

/// 移动端忽略该字段（不报错）：老前端 / 老配置带着 `autostartEnabled` 过来也应成功。
#[cfg(mobile)]
fn set_autostart_enabled(_app: &AppHandle, _enabled: bool) -> AppResult<()> {
    Ok(())
}

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
    settings.autostart_enabled = autostart_enabled(&app)?;
    Ok(settings)
}

#[tauri::command]
pub async fn update_settings(
    app: AppHandle,
    state: State<'_, AppState>,
    patch: SettingsPatch,
) -> AppResult<Settings> {
    // 联动：autostart 即时落到系统侧（桌面写注册表；移动端空操作，见设计 §1.1）。
    if let Some(enabled) = patch.autostart_enabled {
        set_autostart_enabled(&app, enabled)?;
    }
    let mut settings = services::settings::update(&state.pool, &patch).await?;
    settings.autostart_enabled = autostart_enabled(&app)?;
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
    set_autostart_enabled(&app, enabled)?;
    let actual = autostart_enabled(&app)?;
    services::settings::set_autostart_flag(&state.pool, actual).await?;
    Ok(actual)
}

#[tauri::command]
pub async fn get_autostart(app: AppHandle) -> AppResult<bool> {
    autostart_enabled(&app)
}
