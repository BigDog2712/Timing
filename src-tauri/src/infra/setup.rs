//! 启动装配：建库 -> 默认设置 -> 注入状态 -> 托盘 -> 后台落盘。

use tauri::{AppHandle, Manager};

use crate::state::AppState;
use crate::{infra, services};

/// 应用启动流程（供 `Builder::setup` 调用）。
pub fn setup(app: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let app_data_dir = app.path().app_data_dir()?;
    let pool = tauri::async_runtime::block_on(infra::db::init_pool(&app_data_dir))?;
    tauri::async_runtime::block_on(services::settings::ensure_defaults(&pool))?;
    app.manage(AppState::new(pool));
    infra::tray::build(&app)?;
    // AC-23①：窗口已由 tauri.conf.json 创建且 window-state 已恢复位置（插件
    // on_window_ready 在窗口创建时同步执行，早于本 setup 回调），此刻做一次钳制。
    if let Err(err) = infra::window::reclamp_main(&app) {
        eprintln!("[tickbar] startup reclamp failed: {err}");
    }
    // AC-23②：显示器拔插后同样回落可见区（无原生事件，采用轮询，见 infra::monitor）。
    infra::monitor::spawn_watch(app.clone());
    infra::runtime::spawn_flusher(app.clone());
    // [V0.2.0 批 2] 后台调度：15s 提醒扫描（ADR-010）+ 1s 倒计时到点（ADR-011）。
    infra::reminder::spawn_reminder_watcher(app.clone());
    infra::countdown::spawn_countdown_watcher(app.clone());
    // [V0.2.0 批 2] 启动时恢复上次打开的便利贴窗口（ADR-009 / K-14）。
    infra::note_windows::restore_open(&app);
    Ok(())
}
