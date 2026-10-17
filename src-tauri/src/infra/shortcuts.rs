//! 全局快捷键（[P1]）。
//!
//! MVP 不注册任何热键：`capabilities/default.json` 未放行 global-shortcut，
//! 且未编译 `tauri-plugin-global-shortcut`（feature `p1-shortcuts` 默认关闭）。
//! 本模块仅保留接口，`register` 恒返回 `false`（未生效）。
//!
//! P1: 待解锁 —— 届时启用 feature，用 `tauri_plugin_global_shortcut` 注册；
//! 被占用或加速键非法时 `match` Err -> 返回 SHORTCUT_REGISTER_FAILED 并回退备键（K-3，禁止 unwrap）。

use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::enums::ShortcutAction;

/// 注册 / 改键。MVP 未启用全局快捷键，恒返回 false。
pub fn register(_app: &AppHandle, _action: ShortcutAction, _accelerator: &str) -> AppResult<bool> {
    Ok(false)
}
