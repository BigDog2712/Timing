//! Markdown 同步命令 —— 移动端实现。
//!
//! 与桌面的差别只在「落点怎么读写」：桌面的 root 是真实路径，Rust 直接读；Android 的
//! 落点是 SAF 的 `content://` 树 URI，Rust 不认。于是把三步编排收在
//! `app::md_sync_mobile::sync_once`（镜像进 → 合并 → 写回），本层只做取参 / 播报。
//!
//! 合并规则、冲突判定、区块格式因此只有一份，不会出现「手机和电脑算得不一样」。

use tauri::AppHandle;

use crate::app::events;
use crate::app::md_sync_mobile;
use crate::error::{AppError, AppResult};
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncView};
use crate::services::md_sync;
use crate::state::AppState;
use tauri::Manager;

fn announce(app: &AppHandle, report: &MdSyncReport) {
    if report.touched() {
        events::emit_md_sync_changed(app, report);
    }
}

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncView> {
    md_sync::get_view(&app.state::<AppState>().pool).await
}

/// 保存配置。目录还没选（或授权失效）时**只保存不报错**：用户多半是先开开关、
/// 下一步才去选目录；这一步回一句「未授权」会让人以为设置没保存上。
#[tauri::command]
pub async fn md_sync_save(app: AppHandle, config: MdSyncConfig) -> AppResult<MdSyncView> {
    let pool = app.state::<AppState>().pool.clone();
    md_sync::config::save(&pool, &config).await?;
    if config.enabled && md_sync_mobile::saf_status(&app).await?.granted {
        let report = md_sync_mobile::sync_once(&app).await?;
        announce(&app, &report);
    }
    md_sync::get_view(&pool).await
}

#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    let report = md_sync_mobile::sync_once(&app).await?;
    announce(&app, &report);
    Ok(report)
}

/// 打开今日目标文件：手机上交给系统（`ACTION_VIEW` + SAF 授权），由用户装着的
/// Obsidian / 编辑器接管，而不是在应用内嵌预览。
#[tauri::command]
pub async fn md_sync_open(app: AppHandle, kind: MdSyncKind) -> AppResult<()> {
    let pool = app.state::<AppState>().pool.clone();
    let rel = md_sync::mirror::path_of(&pool, kind).await?.ok_or_else(|| {
        AppError::md_sync_config_invalid(format!("「{}」未启用", kind.label()))
    })?;
    crate::app::md_sync_mobile::open_file(&app, &rel).await
}
