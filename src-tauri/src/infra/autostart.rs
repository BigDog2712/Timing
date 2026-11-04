//! 开机自启（P0-6）：经 tauri-plugin-autostart 写/删 HKCU Run 项。

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

/// 开关自启。关闭时必须完全移除（AC-21）。
pub fn set_enabled(app: &AppHandle, enabled: bool) -> AppResult<()> {
    let manager = app.autolaunch();
    if enabled {
        manager.enable().map_err(AppError::io)?;
    } else {
        manager.disable().map_err(AppError::io)?;
    }
    Ok(())
}

/// 查询自启实际状态（读注册表）。
pub fn is_enabled(app: &AppHandle) -> AppResult<bool> {
    app.autolaunch().is_enabled().map_err(AppError::io)
}
