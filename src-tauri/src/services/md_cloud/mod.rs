//! 云端第二落点的编排（V0.11.13，ADR-061）。**唯一入口**：桌面托盘 / 桌面轮询 /
//! 手机 `sync_once` 都从这里进，谁都不要在调用点自己判 `cloud.mode`。
//!
//! ## 判据（写死在这里，别处不许再判一遍）
//!
//! 1. `cloud` 为 `None` / `!enabled` / `!is_usable()` → **就是** `md_sync::run`。
//!    这不是顺手兜底，而是「老配置（V0.11.12 及以前保存的 JSON 没有 cloud 键）的行为
//!    必须逐字不变」的落点：多一次网络、多一个目录、多一行 pending，任何一样都会让
//!    一次正常升级变成「Timing 突然开始碰别的地方」；
//! 2. `LocalFolder` → 只多写一个本地目录，见 `round_folder`；
//! 3. `Webdav` → GET / PUT 由 Timing 自己做，见 `round_webdav`。
//!
//! 云端失败只进 `report.errors`，**不折成 `AppError`**：那会让托盘拿不到本轮的导入
//! 导出计数，也让手机端把一轮部分成功的同步当成整体失败。也因此**不新增存储**。

/* 契约面（`status` / `view` / `test_connection` / `check_paths` / `Outcome.today`）在
T04 接上命令之前没有调用方，必被判死码。与 `models/md_sync_cloud.rs` 同一口径。 */
#![allow(dead_code)]

pub mod backoff;
pub mod pending;
pub mod probe;
pub mod round_conflict;
pub mod round_folder;
pub mod round_push;
pub mod round_webdav;
mod state;

use chrono::Local;
use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_cloud::{
    CloudMode, MdSyncCloud, MdSyncCloudStatus, MdSyncTestResult, MdSyncViewCloud,
};
use crate::models::md_sync_config::MdSyncConfig;
use crate::repositories::md_cloud_pending;
use crate::services::md_sync;

/// 一轮云端同步的结果。`pending` 只对 `Webdav` 有意义（本地目录通道写进去就算同步完了）。
pub struct CloudRoundOutcome {
    pub report: MdSyncReport,
    pub pending: Vec<String>,
    pub today: String,
}

/// 一轮完整同步（含 Obsidian 落点）。云端不可用时与 `md_sync::run` 等价。
pub async fn round(pool: &SqlitePool) -> AppResult<CloudRoundOutcome> {
    let config = md_sync::config::load(pool).await?;
    let today = today();
    let Some(cloud) = usable(&config) else {
        /* 老配置这条路**连 pending 表都不读**：它没有云端，`pending` 填空是事实。 */
        let report = md_sync::run(pool).await?;
        return Ok(CloudRoundOutcome {
            report,
            pending: Vec::new(),
            today,
        });
    };
    let report = match cloud.mode {
        CloudMode::LocalFolder => round_folder::run(pool, cloud).await?,
        CloudMode::Webdav => round_webdav::run(pool, cloud, &today).await?,
    };
    let pending = match cloud.mode {
        CloudMode::LocalFolder => Vec::new(),
        CloudMode::Webdav => md_cloud_pending::pending_dates(pool)
            .await
            .unwrap_or_default(),
    };
    Ok(CloudRoundOutcome {
        report,
        pending,
        today,
    })
}

/// 轮询用：只有「值得广播一次」时才返回 `Some`——导入了数据（老口径）、本轮有远端错误
/// （设置页要能看到它失败过）、待传清单变了。只看 `touched()` 会让「一整天的 401」
/// 在界面上完全无声。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<MdSyncReport>> {
    let config = md_sync::config::load(pool).await?;
    if usable(&config).is_none() {
        /* 老配置：逐字转交，包括它的 `Some/None` 口径。 */
        return md_sync::tick(pool).await;
    }
    let before = md_cloud_pending::pending_dates(pool)
        .await
        .unwrap_or_default();
    let outcome = round(pool).await?;
    let changed =
        outcome.report.touched() || !outcome.report.errors.is_empty() || outcome.pending != before;
    Ok(changed.then_some(outcome.report))
}

/// 设置页要的云端状态。正文在 `state`（读侧投影，不是分派判据）。
pub async fn status(pool: &SqlitePool) -> AppResult<MdSyncCloudStatus> {
    state::status(pool).await
}

/// 设置页一次拿全：基础视图 + 云端状态（`#[serde(flatten)]`，不改 `MdSyncView`）。
pub async fn view(pool: &SqlitePool) -> AppResult<MdSyncViewCloud> {
    state::view(pool).await
}

/// 保存前的路径校验（运行时兜底）：复用模型那一份，不在这里重写一遍比对。
pub fn check_paths(config: &MdSyncConfig) -> Result<(), String> {
    match &config.cloud {
        Some(cloud) => cloud.validate(&config.bindings),
        None => Ok(()),
    }
}

/// 「测试连接」。正文在 `probe`（它要建临时探针文件，不占这里的判据预算）。
pub async fn test_connection(
    pool: &SqlitePool,
    config: &MdSyncConfig,
    secret: Option<&str>,
) -> AppResult<MdSyncTestResult> {
    probe::test_connection(pool, config, secret).await
}

/// 今天的本地日期。与文件模板的 `{date}`、`md_cloud_pending.date` **同源**：出现 UTC
/// 日期会让「今天」在晚上 8 点变成明天。
pub(crate) fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

/// 把两轮 `sync_all` 的报告并进一份。`at` 保留本轮起点：一份报告只有一个「发生在」。
pub(crate) fn absorb(target: &mut MdSyncReport, extra: MdSyncReport) {
    target.exported += extra.exported;
    target.imported += extra.imported;
    for kind in extra.kinds {
        if !target.kinds.contains(&kind) {
            target.kinds.push(kind);
        }
    }
    target.errors.extend(extra.errors);
}

/// 云端通道是否「开了且填全了」。桌面托盘 / 轮询 / 手机 `sync_once` / 手机失败日志
/// 的「未授权还该不该静默」四处判据共用——写第二份必然漂移。
pub(crate) fn usable(config: &MdSyncConfig) -> Option<&MdSyncCloud> {
    config
        .cloud
        .as_ref()
        .filter(|cloud| cloud.enabled && cloud.is_usable())
}
