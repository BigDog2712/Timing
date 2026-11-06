//! 移动端原生能力命令 —— **桌面桩**。
//!
//! SAF 目录与悬浮条是 Android 独有的语义，桌面没有对应物。这四条命令之所以仍然注册，
//! 是因为 `lib.rs` 的命令表只有一份（`check:contract` 按它逐项比对），用 `#[cfg]`
//! 整条剔除会让契约面裂成两份、前端也要跟着分叉。
//!
//! 桌面调到就如实回 `IO_ERROR`（统一口径见 `platform::host::mobile_only`），
//! 不返回空结果伪装成功。

use crate::error::AppResult;
use crate::models::native::{OverlayStatus, SafStatus};

#[tauri::command]
pub async fn md_saf_pick() -> AppResult<SafStatus> {
    Err(crate::platform::host::mobile_only("选择同步目录"))
}

#[tauri::command]
pub async fn md_saf_status() -> AppResult<SafStatus> {
    Err(crate::platform::host::mobile_only("读取同步目录"))
}

#[tauri::command]
pub async fn overlay_set(_enabled: bool) -> AppResult<OverlayStatus> {
    Err(crate::platform::host::mobile_only("悬浮条"))
}

#[tauri::command]
pub async fn overlay_status() -> AppResult<OverlayStatus> {
    Err(crate::platform::host::mobile_only("悬浮条"))
}
