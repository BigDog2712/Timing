//! Markdown 同步命令。
//!
//! 四个命令都只做「取连接池 → 调 service → 返回」：
//! - `md_sync_get`：设置页初始化；
//! - `md_sync_save`：校验 + 落 `settings` KV + 立刻同步；
//! - `md_sync_run`：手动同步；
//! - `md_sync_open`：打开今日目标文件。
//!
//! [v2 撤回] 不再需要 `app_data_dir`：同步是宿主内建功能，出厂落点来自
//! `services::md_sync::config`，不扫插件目录。命令层因此少一次路径解析。

use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncView};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncView> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::get_view(&pool).await
}

#[tauri::command]
pub async fn md_sync_save(app: AppHandle, config: MdSyncConfig) -> AppResult<MdSyncView> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::save_config(&pool, &config).await
}

#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::run(&pool).await
}

#[tauri::command]
pub async fn md_sync_open(app: AppHandle, kind: MdSyncKind) -> AppResult<()> {
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::open(&pool, kind).await
}
