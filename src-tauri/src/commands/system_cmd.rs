//! 窗口 / 系统域命令。
//!
//! V0.3.3：`set_always_on_top`（窗口置顶开关）与 `register_shortcut`（全局快捷键）
//! 随对应功能整体下架，详见 `docs/decisions/ADR-022.md`。窗口置顶改为恒定行为
//! （`infra::window_spec` 的 `always_on_top` 全为 true，主窗由 `tauri.conf.json` 声明）。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::infra::window;
use crate::models::common::{WindowRectDip, WorkAreaDip};
use crate::platform::boot_timing;
use crate::services;
use crate::state::AppState;

/// 显示主窗。
///
/// 这里同时是「首帧可见」的观测点（T17）：主窗以 `visible:false` 启动防白闪（K-1），
/// 前端在 DOM 至少画过一帧后才调它，所以这一次调用 ≈ 用户真正看见界面的时刻。
/// 打点 + 汇总都是幂等的，托盘重复调用不会重复记样本。
#[tauri::command]
pub async fn show_window(app: AppHandle) -> AppResult<()> {
    boot_timing::mark("first_frame");
    boot_timing::report("first_frame");
    window::show_main(&app)
}

/// 主窗所在显示器的工作区（DIP）。前端 auto-fit 拿它当布局上界（ADR-020）：
/// 删掉写死的 384×360 画布后，浮层能占多大空间由当前屏幕决定，而不是常量。
#[tauri::command]
pub async fn main_work_area(app: AppHandle) -> AppResult<WorkAreaDip> {
    window::main_work_area_dip(&app)
}

/// 主条（小条）当前矩形（DIP）。便利贴等浮层据此「默认落在小条附近」——
/// 发起建窗的可能是别的窗口，所以基准必须由后端给出，不能取当前窗。
#[tauri::command]
pub async fn main_window_rect(app: AppHandle) -> AppResult<WindowRectDip> {
    window::main_window_rect_dip(&app)
}

#[tauri::command]
pub async fn hide_window(app: AppHandle) -> AppResult<()> {
    window::hide_main(&app)
}

#[tauri::command]
pub async fn toggle_window(app: AppHandle) -> AppResult<()> {
    window::toggle(&app)
}

#[tauri::command]
pub async fn save_window_position(state: State<'_, AppState>, x: f64, y: f64) -> AppResult<()> {
    services::settings::set_window_position(&state.pool, x, y).await
}

#[tauri::command]
pub async fn quit_app(app: AppHandle) -> AppResult<()> {
    app.exit(0);
    Ok(())
}
