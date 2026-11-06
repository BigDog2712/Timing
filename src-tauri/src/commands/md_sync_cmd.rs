//! Markdown 同步命令（V0.4.0；V0.11.5 起为内核功能，不再依赖插件目录）。
//!
//! 四个命令都只做「取 pool → 调 service → 返回」：
//! - `md_sync_get`：设置页初始化；
//! - `md_sync_save`：校验 + 落 `settings` KV + 立刻同步；
//! - `md_sync_run`：手动同步；
//! - `md_sync_open`：打开今日目标文件。

use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::error::AppResult;
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncView};
use crate::services;
use crate::state::AppState;

/// 手动同步与保存后同步都会在这里广播一次。
///
/// [V0.11.3] 之前只有后台轮询任务会 emit：用户点「立即同步」把 Markdown 的改动导入
/// 数据库后，**除设置页外的窗口一律不刷新**——今天计时区、待办、便利贴都还是旧数据，
/// 要等下一次轮询（现在还是 15 分钟）才跟上。手动同步的意义就是「现在就要看到」，
/// 所以导入非零时同样广播。
fn announce(app: &AppHandle, report: &MdSyncReport) {
    if report.touched() {
        events::emit_md_sync_changed(app, report);
    }
}

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncView> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::get_view(&pool).await
}

#[tauri::command]
pub async fn md_sync_save(app: AppHandle, config: MdSyncConfig) -> AppResult<MdSyncView> {
    let pool = app.state::<AppState>().pool.clone();
    /* 保存会顺手同步一轮；把那一轮的报告也拿出来广播，结果与「立即同步」一致。 */
    let (view, report) = services::md_sync::save_config_with_report(&pool, &config).await?;
    announce(&app, &report);
    Ok(view)
}

#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    let pool = app.state::<AppState>().pool.clone();
    let report = services::md_sync::run(&pool).await?;
    announce(&app, &report);
    Ok(report)
}

#[tauri::command]
pub async fn md_sync_open(app: AppHandle, kind: MdSyncKind) -> AppResult<()> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::open(&pool, kind).await
}
