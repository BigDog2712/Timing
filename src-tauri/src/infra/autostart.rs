//! 开机自启（P0-6）：经 tauri-plugin-autostart 写/删 HKCU Run 项。
//!
//! ## 注册表值名 = `productName`，不是 identifier
//!
//! `tauri-plugin-autostart` 用 `app.package_info().name` 作值名（见该插件
//! `src/lib.rs` 的 `AutoLaunchBuilder::new().set_app_name(...)`），而 `package_info().name`
//! 来自 `tauri.conf.json::productName`。所以改名后旧值名是 `TickBar`、新值名是 `Timing`。
//!
//! ## 为什么要自己动注册表
//!
//! `auto-launch 0.6` 在 `enable()` 时**同时**写两个位置：
//! 1. `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\<name>`
//! 2. `HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run\<name>`
//!    （任务管理器「启动」页的开关记录）
//!
//! 只删第 1 处会在「任务管理器 → 启动」里留一个永远的孤儿条目（点了没反应、指向已卸载
//! 的 exe）。所以 `remove_legacy_value` 必须两处都删，删不到静默忽略。

use tauri::AppHandle;
use tauri_plugin_autostart::ManagerExt;

use crate::error::{AppError, AppResult};

/// `enable()` 写的第一个位置。
#[cfg(windows)]
const RUN_KEY: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Run";
/// 任务管理器启动项开关（第二个位置）。
#[cfg(windows)]
const STARTUP_APPROVED_KEY: &str =
    r"SOFTWARE\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

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

/// 旧值名是否还挂在 `Run` 下（= 旧版本开过自启）。
///
/// 读不到（无权限 / 键不存在）一律按「没有」处理：这个判断只用于决定要不要清理，
/// 保守放过比误删用户当前的自启更安全。
#[cfg(windows)]
pub fn legacy_value_exists(name: &str) -> bool {
    use windows_registry::CURRENT_USER;
    match CURRENT_USER.open(RUN_KEY) {
        Ok(key) => key.get_string(name).is_ok(),
        Err(_) => false,
    }
}

#[cfg(not(windows))]
pub fn legacy_value_exists(_name: &str) -> bool {
    false
}

/// 删除旧值名：`Run` 与 `StartupApproved\Run` 两处都删。
///
/// 返回是否真的删掉了至少一处。删不到静默忽略——这个函数的全部意义是「顺手清理」，
/// 失败不能阻断启动，也不该让迁移被判失败。
#[cfg(windows)]
pub fn remove_legacy_value(name: &str) -> Result<bool, String> {
    use windows_registry::CURRENT_USER;
    let mut removed = false;
    for path in [RUN_KEY, STARTUP_APPROVED_KEY] {
        /* StartupApproved\Run 可能整个键都不存在（从未用过自启的机器）。
        此时 `options().write().open()` 直接报 FILENOTFOUND，忽略即可。 */
        let Ok(key) = CURRENT_USER.options().write().open(path) else {
            continue;
        };
        if key.remove_value(name).is_ok() {
            removed = true;
        }
    }
    Ok(removed)
}

#[cfg(not(windows))]
pub fn remove_legacy_value(_name: &str) -> Result<bool, String> {
    Ok(false)
}
