//! Markdown 同步命令（V0.4.0；V0.11.5 起为内核功能，不再依赖插件目录）。
//!
//! [V0.11.13] 七个命令都只做「取 pool → 调 service → 返回」。判据（老配置 / 本地目录 /
//! WebDAV）全部在 `services::md_cloud` 里，本层**一次都不判 `cloud.mode`**：判据抄两份，
//! 改规则时必定漏一处。
//!
//! 密码走 `md_credential::apply`（与移动端同一份三分语义），不进 `MdSyncConfig`、
//! 不进 `settings` 表、不进日志。

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::commands::md_credential;
use crate::error::{AppError, AppResult};
use crate::infra::secret::{self as keychain, KEY_WEBDAV};
use crate::models::md_sync::{MdSyncConfig, MdSyncKind, MdSyncReport};
use crate::models::md_sync_cloud::{
    MdBackupItem, MdBackupRestoreResult, MdSyncTestResult, MdSyncViewCloud,
};
use crate::services::{md_backup, md_cloud, md_sync};
use crate::state::AppState;

/// 手动同步、保存后同步、后台轮询都会在这里广播一次。
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

fn pool_of(app: &AppHandle) -> SqlitePool {
    app.state::<AppState>().pool.clone()
}

/// 设置页初始化：基础视图（配置 + 落点状态）+ 云端状态，一次拿全。
#[tauri::command]
pub async fn md_sync_get(app: AppHandle) -> AppResult<MdSyncViewCloud> {
    md_cloud::view(&pool_of(&app)).await
}

/// 保存 = 「云端路径校验 → 密码 → 配置 → 云端一轮 → 视图」。
///
/// 顺序不是随手排的：
/// 1. 云端那半的路径校验放最前：它决定「要不要写凭据」，而凭据一旦写进系统就没有
///    回滚可言（`secret::clear` 是删除，不是撤销）；
/// 2. **密码先于配置**：凭据写失败时配置文件一个字都还没改，用户重试一次就是完整的
///    一次操作。反过来（先写配置）会留下「配置看起来填全了、密文没写进去」的半截
///    状态——此后每一轮都是 401，而设置页 `hasSecret: false` 与填满的输入框互相
///    矛盾，没人能从这两条线索里猜出「上次保存其实失败过」；
/// 3. 云端那一轮在配置之后：它读的是库里的新配置，不能拿前端入参去跑，否则
///    「保存了但没落库」与「落库了但跑的是没保存的值」两种故障长得一模一样。
///
/// **不用** `md_sync::save_config_with_report`：它内部只跑 `sync_all(None)`（本地落点
/// 那一轮），跑不到云端，结果是「保存成功、文件没上传」，而设置页会显示成功。
#[tauri::command]
pub async fn md_sync_save(
    app: AppHandle,
    config: MdSyncConfig,
    secret: Option<String>,
) -> AppResult<MdSyncViewCloud> {
    md_cloud::check_paths(&config).map_err(AppError::md_sync_config_invalid)?;
    md_credential::apply(secret).await?;
    let pool = pool_of(&app);
    md_sync::config::save(&pool, &config).await?;
    /* [V0.11.18] 通道可能刚被改（只用本地 ↔ 本地 + 云端），托盘那一项的标签要立刻跟上。
       K-30 的「仅状态迁移时重建」在这里**不够**：通道切换不是状态迁移（PRD §3.2）。
       位置在 `config::save` **之后**、`round` **之前**：标签要读的是刚落库的那份配置。
       这不是新命令、不是新事件 → 契约账面零变；`pool` 复用上面那个变量，不再取一次。 */
    #[cfg(desktop)]
    events::refresh_tray(&app, &pool).await;
    let outcome = md_cloud::round(&pool).await?;
    announce(&app, &outcome.report);
    md_cloud::view(&pool).await
}

/// 手动同步。走 `md_cloud::round` 而不是 `md_sync::run`：用户按下「立即同步」要的是
/// 「现在就传上去」，只跑本地落点等于把上传留到下一次轮询（最坏 15 分钟）。
#[tauri::command]
pub async fn md_sync_run(app: AppHandle) -> AppResult<MdSyncReport> {
    /* [V0.11.19] 手动入口统一走 `round_manual`：T04 的「点一次立即同步 → 解除清理
       暂停」只需要挂在那一个函数上，两处手动入口不会各记一份。 */
    let outcome = md_cloud::round_manual(&pool_of(&app)).await?;
    announce(&app, &outcome.report);
    Ok(outcome.report)
}

#[tauri::command]
pub async fn md_sync_open(app: AppHandle, kind: MdSyncKind) -> AppResult<()> {
    md_sync::open(&pool_of(&app), kind).await
}

/// 测试连接。密码框没碰（`None`）就用已存密文；用户填了空串（`Some("")`）照原样往下
/// 传，由 `probe` 自己判「没填密码」——命令层不替服务层猜语义，否则两处的判断会打架。
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
    md_cloud::test_connection(&pool_of(&app), &config, provided.as_deref()).await
}

/// 备份列表：纯读盘，不需要 pool，也没有可失败的路径（读不出就是空列表）。
#[tauri::command]
pub async fn md_backup_list() -> AppResult<Vec<MdBackupItem>> {
    Ok(md_backup::items())
}

/// 用一份备份覆盖回去。`target` 是落点标识，`None` = 按备份文件名推出来的归属
/// （老备份无前缀，前端让用户自己选）。`name` 来自前端，由 service 按不可信输入解析。
/// 用系统默认程序打开一份备份（PRD 8.2-5）。`name` 来自前端，由 service 按不可信
/// 输入解析（拒绝 `..` / `/` / `\` / 空串）——这条路径要把文件交给系统去**执行**，
/// 路径注入的后果不是「读错文件」而是「打开任意文件」。
#[tauri::command]
pub async fn md_backup_open(name: String) -> AppResult<()> {
    md_backup::open(&name)
}

#[tauri::command]
pub async fn md_backup_restore(
    app: AppHandle,
    name: String,
    target: Option<String>,
) -> AppResult<MdBackupRestoreResult> {
    let result = md_backup::restore(&pool_of(&app), &name, target.as_deref()).await?;
    /* 恢复把记录 / 待办 / 便利贴写回 SQL，是一次真实的业务写入，必须让 md 链看见。
       `md_sync_cmd.rs` 里只允许这一处打标记：`md_sync_save` 自己就会跑一轮同步。 */
    md_sync::dirty::mark("record");
    Ok(result)
}
