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
/* [V0.11.19 变更 A] 往期真删：骨架（`purge/mod.rs`）+ 两路互不合并的取证。
   手机端不装挂点（`round_webdav` / `round_folder` 的 ⑩ 都是 `#[cfg(not(mobile))]`），
   但模块本身编译到两端：`purge::status` 是设置页共用的只读投影，且这里没有平台 API。 */
pub mod purge;
pub mod round_conflict;
pub mod round_folder;
pub mod round_push;
pub mod round_webdav;
mod state;
/* [V0.11.16] 远端错误的文案表（从 `round_push` 搬出）：「测试连接」的三关也要用同一张。
   `pub(crate)` 是为了让 `tests/md_webdav_text.rs` 能直接断言 `fail_text_at` 的关卡分支。 */
pub(crate) mod text;

use chrono::Local;
use sqlx::SqlitePool;

#[cfg(mobile)]
use crate::error::AppError;
use crate::error::AppResult;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_cloud_purge::PurgeChannel;
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

/// 手机端拿到 `mode == LocalFolder` 时的口径（[V0.11.14] 修 O12）。
///
/// 与 `commands::md_sync_cmd` 的 `NO_BACKUP` 同一口径：能力不在这端，就用既有错误码
/// `MD_SYNC_CONFIG_INVALID` 回一句**用户能照做**的话，不新增错误码。
#[cfg(mobile)]
const NO_LOCAL_FOLDER_ON_MOBILE: &str = "手机端不支持「本地目录」云端通道：请把云端通道改成 WebDAV（本地目录要靠电脑上的网盘客户端同步，手机上写不进去）";

/// 一轮完整同步（含 Obsidian 落点）。云端不可用时与 `md_sync::run` 等价。
pub async fn round(pool: &SqlitePool) -> AppResult<CloudRoundOutcome> {
    let config = md_sync::config::load(pool).await?;
    /* 手机端不支持「本地目录」通道（[V0.11.14] 修 O12）。那条路假设用户电脑上有个
    网盘客户端在同步一个真实目录，手机上既没有那个目录也没有客户端，`local_root` 里
    存的多半是一个 Windows 路径。旧版会一路走到 `round_folder`，在「解析不出绝对
    路径」处变成报告里一行错误、而这一轮仍然「成功」；现在在入口就说清怎么办。
    前端（`MdSyncCloudCard` / `useMdSyncDraft`）已把这类配置按 WebDAV 显示并落库，
    这里是兜底：升级前存下的配置、或别的入口写进来的配置，都不会再走进那条死路。 */
    #[cfg(mobile)]
    if let Some(cloud) = config.cloud.as_ref() {
        if cloud.enabled && cloud.mode == CloudMode::LocalFolder {
            return Err(AppError::md_sync_config_invalid(NO_LOCAL_FOLDER_ON_MOBILE));
        }
    }
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
        CloudMode::LocalFolder => round_folder::run(pool, cloud, &config.bindings, &today).await?,
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

/// 手动入口（「立即同步」命令 / 托盘那一项）的**唯一**包装。
///
/// [V0.11.19] 抽出来不是为了加逻辑，是为了让 T04 变更 A 的「点一次立即同步 → 解除
/// 清理暂停」只有一个挂载点：两处调用方都不该各自记住「手动轮还要先 resume」。
/// 退出前那一轮（`tray_quit`）走自己的路径，不从这里进。
pub async fn round_manual(pool: &SqlitePool) -> AppResult<CloudRoundOutcome> {
    /* 暂停是「连续 3 个自然日失败」，解除它必须有人明确表达「现在就再试一次」。
       只清**当前生效通道**的那份：另一条通道的现场（可能是另一套失败原因）不动。 */
    let config = md_sync::config::load(pool).await?;
    let channel = match config.cloud.as_ref().map_or(CloudMode::LocalFolder, |cloud| cloud.mode) {
        CloudMode::LocalFolder => PurgeChannel::Folder,
        CloudMode::Webdav => PurgeChannel::Webdav,
    };
    purge::resume(pool, channel).await?;
    round(pool).await
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

/// 保存之后要不要顺手跑一轮同步（手机端 `md_sync_save` 的判据，[V0.11.14] 修 N2）。
///
/// 抽成纯函数是为了能被单测钉住：真正的调用点要 `AppHandle`（原生桥 + 事件），
/// 为它造一套夹具比这段判断本身贵得多。
///
/// 三条：
/// 1. 总开关关着 → 不跑（`sync_once` 对关闭状态只会返回一份空报告）；
/// 2. **云端可用 → 跑，不问 SAF 授权**：`sync_once` 里云端分支排在 SAF 检查**之前**，
///    「只配 WebDAV、不选日记目录」是合法用法。旧版把 SAF 授权当成前置条件，于是
///    这类用户永远走不到自动同步——`?` 还会把桥调用失败折成保存失败（N2 的另一半）；
/// 3. 云端不可用 → 才看 SAF：没授权的那一轮只可能回「同步目录未授权」。
pub fn should_autosync(enabled: bool, cloud_usable: bool, saf_granted: bool) -> bool {
    enabled && (cloud_usable || saf_granted)
}
