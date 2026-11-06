//! Markdown 同步命令 —— 移动端实现。
//!
//! 与桌面的差别只在「落点怎么读写」：桌面的 root 是真实路径，Rust 直接读；Android 的
//! 落点是 SAF 的 `content://` 树 URI，Rust 不认。于是把三步编排收在
//! `app::md_sync_mobile::sync_once`（镜像进 → 合并 → 写回），本层只做取参 / 播报。
//!
//! 合并规则、冲突判定、区块格式因此只有一份，不会出现「手机和电脑算得不一样」。
//! 密码（`md_credential`）与云端视图（`md_cloud::view`）与桌面逐字相同；**只有备份不落地**，
//! 理由见 `NO_BACKUP`。

use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::app::md_sync_mobile;
use crate::commands::md_credential;
use crate::error::{AppError, AppResult};
use crate::infra::secret::{self as keychain, KEY_WEBDAV};
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport};
use crate::models::md_sync_cloud::{
    MdBackupItem, MdBackupRestoreResult, MdSyncTestResult, MdSyncViewCloud,
};
use crate::services::{md_cloud, md_sync};
use crate::state::AppState;

fn announce(app: &AppHandle, report: &MdSyncReport) {
    if report.touched() {
        events::emit_md_sync_changed(app, report);
    }
}

/// 备份在手机上没有可用落点：`services::md_backup` 读写的是**数据根**下的 `backups/`，
/// 而 Android 的数据根是应用私有目录——用户既看不见也导不出（导出要走 SAF，本轮没做）。
/// 与其给一份「存了但拿不到」的备份，不如明说「请在电脑上操作」。用
/// `MD_SYNC_CONFIG_INVALID` 而不新增错误码：契约闭集，且这确实属于「这端不提供该能力」。
const NO_BACKUP: &str = "手机端暂不支持备份查看与恢复，请在电脑上操作";

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncViewCloud> {
    md_cloud::view(&app.state::<AppState>().pool).await
}

/// 保存配置。目录还没选（或授权失效）时**只保存不报错**：用户多半是先开开关、
/// 下一步才去选目录；这一步回一句「未授权」会让人以为设置没保存上。
///
/// 保存后顺手同步一轮，但**这一轮的失败不算保存失败**：开关已经写进库了，
/// 回一句红字会让用户以为「没开成功」而反复点。真正的原因留给「立即同步」去说。
/// [V0.11.14] 修 N2：判据（含 SAF 授权检查）整个搬到
/// `md_cloud::should_autosync`，任何一步失败都只落一行 warn，**绝不影响返回值**——
/// 旧版 `saf_status(..).await?` 会在配置已经落库之后把「保存」变成失败。
///
/// 密码与桌面同一份三分语义，且同样**先于**配置落库：凭据写失败时配置一个字都还没改，
/// 用户重试一次就是完整的一次操作（详见 `md_credential`）。
#[tauri::command]
pub async fn md_sync_save(
    app: AppHandle,
    config: MdSyncConfig,
    secret: Option<String>,
) -> AppResult<MdSyncViewCloud> {
    md_cloud::check_paths(&config).map_err(AppError::md_sync_config_invalid)?;
    md_credential::apply(secret).await?;
    let pool = app.state::<AppState>().pool.clone();
    md_sync::config::save(&pool, &config).await?;

    /* 云端可用时**不必**问 SAF（`sync_once` 的云端分支排在 SAF 检查之前），也就不该
    被它挡住；这里连那次原生桥往返都省掉。 */
    let cloud_usable = md_cloud::usable(&config).is_some();
    let saf_granted = if cloud_usable {
        false
    } else {
        match md_sync_mobile::saf_status(&app).await {
            Ok(status) => status.granted,
            /* 原生桥不可用 / 调用失败只意味着「这次不顺手同步」，与「保存」无关。 */
            Err(err) => {
                crate::log_warn!("md sync save: 读不到同步目录授权，跳过顺手同步：{err}");
                false
            }
        }
    };
    if md_cloud::should_autosync(config.enabled, cloud_usable, saf_granted) {
        if let Ok(report) = md_sync_mobile::sync_once(&app).await {
            announce(&app, &report);
        }
    }
    md_cloud::view(&pool).await
}

/// 手动同步：`sync_once` 内部已含云端那一步（先写 SAF，再走 `md_cloud`），
/// 本层不再叠一轮，否则同一天会被上传两次。
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

/// 测试连接：凭据解析与桌面一致（`None` = 用已存密文，空串照原样下传）。
#[tauri::command]
pub async fn md_sync_test(
    app: AppHandle,
    config: MdSyncConfig,
    secret: Option<String>,
) -> AppResult<MdSyncTestResult> {
    let provided = match secret {
        Some(value) => Some(value),
        None => keychain::get(KEY_WEBDAV).await.ok().flatten(),
    };
    let pool = app.state::<AppState>().pool.clone();
    md_cloud::test_connection(&pool, &config, provided.as_deref()).await
}

#[tauri::command]
pub async fn md_backup_list() -> AppResult<Vec<MdBackupItem>> {
    Err(AppError::md_sync_config_invalid(NO_BACKUP))
}

#[tauri::command]
pub async fn md_backup_restore(
    _app: AppHandle,
    _name: String,
    _target: Option<String>,
) -> AppResult<MdBackupRestoreResult> {
    Err(AppError::md_sync_config_invalid(NO_BACKUP))
}
