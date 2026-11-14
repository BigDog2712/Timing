//! 多窗口域命令 —— **移动端桩**（V1-Android）。
//!
//! 桌面是「每个面板一个 WebviewWindow」（设置 / 事项 / 计时 / 便利贴 `note-{id}`）；
//! 手机是单 Activity 多页面路由（`MobileShell` 的 4 个 Tab + Sheet），根本没有第二个
//! 窗口可开。因此这 5 条命令在移动端一律返回 `IO_ERROR` + 中文说明：
//! 真被调到说明前端走了桌面路径，应该当场暴露，而不是静默成功让人以为窗开了。
//!
//! 函数名与参数签名必须与 `window_cmd.rs` 完全一致 —— 命令名是契约面。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::foreground::ForegroundWindow;
use crate::platform::host::desktop_only;
use crate::state::AppState;

/// 当前前台窗口（[0.13] 冷启动自动接管）—— **移动端没有前台窗口追踪**。
///
/// 回 `Ok(None)` 而不是 `IO_ERROR`：药丸那条链路把 `None` 当"不知道"，静默跳过正是这里的
/// 正确语义（移动端本来就没有"切到某个应用就接管"的产品口径）；回错误只会让每次启动都
/// 多一条被前端吞掉的噪声。
#[tauri::command]
pub fn get_foreground_window() -> Result<Option<ForegroundWindow>, String> {
    Ok(None)
}

#[tauri::command]
pub async fn open_settings_window(_app: AppHandle) -> AppResult<()> {
    Err(desktop_only("open_settings_window"))
}

#[tauri::command]
pub async fn open_todos_window(_app: AppHandle) -> AppResult<()> {
    Err(desktop_only("open_todos_window"))
}

#[tauri::command]
pub async fn open_timer_window(_app: AppHandle) -> AppResult<()> {
    Err(desktop_only("open_timer_window"))
}

#[tauri::command]
pub async fn open_note_window(
    _app: AppHandle,
    _state: State<'_, AppState>,
    _note_id: i64,
) -> AppResult<()> {
    Err(desktop_only("open_note_window"))
}

/// 收纳便利贴窗口：桌面是「落盘几何 + 销毁窗口」，移动端便利贴走页内编辑
/// （P1，本轮未做），没有窗口可收。
#[tauri::command]
pub async fn close_note_window(
    _app: AppHandle,
    _state: State<'_, AppState>,
    _note_id: i64,
) -> AppResult<()> {
    Err(desktop_only("close_note_window"))
}
