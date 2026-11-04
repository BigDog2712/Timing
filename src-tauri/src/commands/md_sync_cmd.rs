//! Markdown 同步命令（V0.4.0 / 插件 API v2）。
//!
//! 四个命令都只做「取路径 → 调 service → 返回」：
//! - `md_sync_get`：设置页初始化；
//! - `md_sync_save`：校验 + 落 `settings` KV + 立刻同步；
//! - `md_sync_run`：手动同步；
//! - `md_sync_open`：打开今日目标文件。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncView};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncView> {
    let dir = app.path().app_data_dir().map_err(AppError::io)?;
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::get_view(&pool, &dir).await
}

#[tauri::command]
pub async fn md_sync_save(app: AppHandle, config: MdSyncConfig) -> AppResult<MdSyncView> {
    let dir = app.path().app_data_dir().map_err(AppError::io)?;
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::save_config(&pool, &dir, &config).await
}

#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    let dir = app.path().app_data_dir().map_err(AppError::io)?;
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::run(&pool, &dir).await
}

#[tauri::command]
pub async fn md_sync_open(app: AppHandle, kind: MdSyncKind) -> AppResult<()> {
    let dir = app.path().app_data_dir().map_err(AppError::io)?;
    let pool = app.state::<AppState>().pool.clone();
    services::md_sync::open(&pool, &dir, kind).await
}
