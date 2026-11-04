//! 窗口 / 系统域命令 —— **移动端桩**（V1-Android）。
//!
//! 为什么不是整条删掉：命令名是契约面（65 条由 `check:contract` 静态比对），删一条
//! 前端 `ipc.ts` 就会指向不存在的命令。这里保留同名函数，只把「做不到」如实返回。
//!
//! 两类处理：
//! - **幂等空操作**（`show/hide/toggle_window`、`save_window_position`）：前端首帧与
//!   拖动结束会调它们，回错误只会在控制台刷红，而语义上「已经显示 / 位置无处可存」
//!   本来就是成功；移动端窗口由系统托管，没有可操作对象。
//! - **明确不支持**（`main_work_area` / `main_window_rect` / `quit_app`）：返回
//!   `IO_ERROR` + 中文说明，前端 `errorText()` 已有该码文案，不新增错误码。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::common::{WindowRectDip, WorkAreaDip};
use crate::platform::boot_timing;
use crate::platform::host::desktop_only;
use crate::state::AppState;

/// 首帧可见的观测点（T17）：移动端没有「显示窗口」这步，但「前端画完第一帧」仍是
/// 启动耗时的终点，打点必须留着，否则移动端永远拿不到 `setup → first_frame` 这段。
#[tauri::command]
pub async fn show_window(_app: AppHandle) -> AppResult<()> {
    boot_timing::mark("first_frame");
    boot_timing::report("first_frame");
    Ok(())
}

/// 主窗工作区：移动端没有浮层需要 auto-fit 上界。
#[tauri::command]
pub async fn main_work_area(_app: AppHandle) -> AppResult<WorkAreaDip> {
    Err(desktop_only("main_work_area"))
}

/// 主条矩形：移动端没有「小条」，浮层落点也无从谈起。
#[tauri::command]
pub async fn main_window_rect(_app: AppHandle) -> AppResult<WindowRectDip> {
    Err(desktop_only("main_window_rect"))
}

/// 隐藏：移动端退到后台由系统（返回键 / Home）负责，不由前端命令驱动。
#[tauri::command]
pub async fn hide_window(_app: AppHandle) -> AppResult<()> {
    Ok(())
}

/// 切换显隐：同上，无对象可切。
#[tauri::command]
pub async fn toggle_window(_app: AppHandle) -> AppResult<()> {
    Ok(())
}

/// 存窗口位置：移动端单 Activity 全屏，位置由系统管理。回 `Ok` 让前端「拖完落盘」
/// 这条路径自然结束，不产生假错误。
#[tauri::command]
pub async fn save_window_position(_state: State<'_, AppState>, _x: f64, _y: f64) -> AppResult<()> {
    Ok(())
}

/// 退出应用：Android 不允许应用自杀（系统会在合适的时机回收）；前端也不提供该入口。
#[tauri::command]
pub async fn quit_app(_app: AppHandle) -> AppResult<()> {
    Err(desktop_only("quit_app"))
}
