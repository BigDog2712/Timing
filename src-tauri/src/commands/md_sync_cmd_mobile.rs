//! Markdown 同步命令 —— **移动端桩**（V1-Android）。
//!
//! 为什么保留注册但一律不支持（设计 §1.4）：桌面的落点是**路径字符串**，Android 只能
//! 拿到 SAF 的 `content://` 持久 URI，两者模型不同构；配置模型要先扩容才谈得上实现，
//! 本轮 P0 明确排除。前端设置页在 `IS_MOBILE` 时已隐藏「同步」页签，这 4 条命令
//! 理论上不会被调 —— 真被调到就如实回 `IO_ERROR`，别让用户以为同步成功了。
//!
//! 注意：错误码用现有 `IO_ERROR`，不新增第 17 码。

use tauri::AppHandle;

use crate::error::{AppError, AppResult, ErrorCode};
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport, MdSyncView};

/// 四条命令共用一句话，避免文案漂开。
fn unsupported() -> AppError {
    AppError::new(
        ErrorCode::IoError,
        "移动端暂不支持 Markdown 同步（落点需 SAF 目录授权，见 PRD Q2）",
    )
}

#[tauri::command]
pub async fn md_sync_get(_app: AppHandle) -> AppResult<MdSyncView> {
    Err(unsupported())
}

#[tauri::command]
pub async fn md_sync_save(_app: AppHandle, _config: MdSyncConfig) -> AppResult<MdSyncView> {
    Err(unsupported())
}

#[tauri::command]
pub async fn md_sync_run(_app: AppHandle) -> AppResult<MdSyncReport> {
    Err(unsupported())
}

#[tauri::command]
pub async fn md_sync_open(_app: AppHandle, _kind: MdSyncKind) -> AppResult<()> {
    Err(unsupported())
}
