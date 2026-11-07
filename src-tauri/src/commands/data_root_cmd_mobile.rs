//! 数据根命令 —— 移动端实现（三条桩）。
//!
//! 手机上的数据根是系统给的沙箱目录，用户既不能选也不能改（`Roots::sandbox`，进
//! `app::bootstrap` 时注入）。所以三条命令在桌面独占能力面前一律回
//! `platform::host::desktop_only(..)` = `IO_ERROR` + 「仅桌面端可用」。
//!
//! **不新增错误码**（契约闭集，设计 §8-5）。命令名与注册点两平台一致，`lib.rs` 零改动。

use tauri::AppHandle;

use crate::error::AppResult;
use crate::models::data_root::DataRootInfo;
use crate::platform::host;

#[tauri::command]
pub async fn data_root_get(_app: AppHandle) -> AppResult<DataRootInfo> {
    Err(host::desktop_only("data_root_get"))
}

#[tauri::command]
pub async fn data_root_change(_app: AppHandle, _path: Option<String>) -> AppResult<DataRootInfo> {
    Err(host::desktop_only("data_root_change"))
}

#[tauri::command]
pub async fn data_root_open() -> AppResult<()> {
    Err(host::desktop_only("data_root_open"))
}
