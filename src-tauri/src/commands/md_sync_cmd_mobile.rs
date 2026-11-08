//! Markdown 同步命令 —— 移动端实现。
//!
//! ## [V0.11.22] 只走云端
//!
//! 本地日记目录（SAF）那条同步通路这一轮下线（主人：「此功能去除，仅保留云端同步」）。
//! 于是本层与桌面的差别只剩一句：**没有云端就没有落点**。落点的合并规则、冲突判定、
//! 区块格式仍与桌面同一份（`services::md_cloud`）。
//!
//! ## 备份在手机上真做了
//!
//! v0.11.21 及之前 `md_backup_*` 一律回「请在电脑上操作」，理由是「备份存在应用私有目录，
//! 用户看不见也导不出」。这个理由对「打开」成立，对「恢复」不成立——恢复是
//! **读备份 → 写回 SQL + 文件**，全程在应用内完成，一个字节都不需要用户摸到文件。
//! 所以本轮 `md_backup_list` / `md_backup_restore` 接了真实现，`md_backup_open` 仍是桩
//! （交给系统打开一份用户拿不到的文件没有意义），但换成了自己的话。
//!
//! 归属限制见 [`backup_restorable`]：手机只认 `webdav__`。

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
use crate::services::{md_backup, md_cloud, md_sync};
use crate::state::AppState;

fn announce(app: &AppHandle, report: &MdSyncReport) {
    if report.touched() {
        events::emit_md_sync_changed(app, report);
    }
}

/// 手机端能恢复哪些备份：判据在 `services::md_backup::restorable_on_mobile`
/// （手机只有 WebDAV 一个落点，`obsidian__` / 老备份一律拒绝并说明去哪做）。
/// 这里只转发——判据放 `services` 是为了让桌面目标的用例够得着。

#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncViewCloud> {
    md_cloud::view(&app.state::<AppState>().pool).await
}

/// 保存配置。云端没填全时**只保存不报错**（用户多半是分两步填）；保存后顺手跑一轮，
/// 但那一轮的失败不算保存失败——开关已经落库，回红字只会让人反复点。
///
/// 密码与桌面同一份三分语义，且同样**先于**配置落库（见 `md_credential`）。
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

    /* [V0.11.22] 顺手同步的判据收窄成「云端可用」：SAF 那一项不再参与
    （`should_autosync` 的第三个参数恒 false，函数本身留给桌面与既有用例）。 */
    if md_cloud::should_autosync(config.enabled, md_cloud::usable_webdav(&config).is_some(), false) {
        if let Ok(report) = md_sync_mobile::sync_once(&app).await {
            announce(&app, &report);
        }
    }
    md_cloud::view(&pool).await
}

/// 手动同步 = 「现在就再试一次」，所以走 `round_manual`（它会解除「连续 3 个自然日失败」
/// 的清理暂停，与桌面同一个入口）。
///
/// [V0.11.22] 云端不可用时**不再回落 SAF**：回落只会拿到「同步目录未授权」，
/// 与真正要用户做的事（去填云端）差着两页。这里直接给一句能照做的配置错误。
#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    let pool = app.state::<AppState>().pool.clone();
    let config = md_sync::config::load(&pool).await?;
    if md_cloud::usable_webdav(&config).is_none() {
        return Err(AppError::md_sync_config_invalid(
            "手机端只同步云端：先在「设置 → 数据管理」里填好服务地址、账号和应用密码，再点保存",
        ));
    }
    let report = md_cloud::round_manual(&pool).await?.report;
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

/// 备份列表：与桌面同一份 `store::list`（按留底时间倒序）。
#[tauri::command]
pub async fn md_backup_list() -> AppResult<Vec<MdBackupItem>> {
    Ok(md_backup::items())
}

/// 手机上没有「打开备份」的落点：私有目录里的文件交给系统打开，用户拿到的是一个
/// 自己找不到的路径。恢复不需要它，所以只留一句能照做的说明。
#[tauri::command]
pub async fn md_backup_open(_name: String) -> AppResult<()> {
    Err(AppError::md_sync_config_invalid(
        "备份存在应用私有目录里，手机上打不开；要留档请到电脑上操作",
    ))
}

/// 用一份备份覆盖回去（写回文件 + 导入 SQL）。归属判据在 [`backup_restorable`]。
#[tauri::command]
pub async fn md_backup_restore(
    app: AppHandle,
    name: String,
    target: Option<String>,
) -> AppResult<MdBackupRestoreResult> {
    md_backup::restorable_on_mobile(&name).map_err(AppError::md_sync_config_invalid)?;
    let pool = app.state::<AppState>().pool.clone();
    /* `target` 由前端原样透传：备份名自己带着归属（`webdav__`），
    正常路径下前端传 `None`，服务层按文件名解析。 */
    let result = md_backup::restore(&pool, &name, target.as_deref()).await?;
    /* 恢复是真实的业务写入，必须让下一轮同步看见（与桌面 `md_sync_cmd` 同口径）。 */
    md_sync::dirty::mark("record");
    Ok(result)
}
