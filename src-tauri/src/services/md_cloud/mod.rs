//! 云端两条通路的编排（V0.11.13，ADR-061；V0.11.26 双通路拆分，设计 §1.3）。
//!
//! **唯一入口**：桌面托盘 / 桌面调度链 / 手机 `sync_once` 都从这里进，
//! 谁都不要在调用点自己判「通路可不可用」。
//!
//! ## 判据（写死在这里，别处不许再判一遍）
//!
//! `usable_folder` / `usable_webdav` 是「这条通路会不会跑」的**唯一出口**
//! （托盘标签、调度链、`round`、`plan_of` 四处共用）：
//!
//! 1. 两条通路都不可用 → **就是** `md_sync::run`。这不是顺手兜底，而是「老配置
//!    （V0.11.12 及以前保存的 JSON 没有 cloud 键）的行为必须逐字不变」的落点；
//! 2. folder 可用 → `round_folder::run`（只写一个本地目录，零网络代码）；
//! 3. webdav 可用 → `round_webdav::run`（GET / PUT 由 Timing 自己做）。
//!
//! ## [V0.11.26] 一轮的形状（R4：双通路同时开）
//!
//! `round()` = 先本地同步轮、后云端轮，顺序各跑一遍，**报告级失败互不阻断**
//! （`report.errors` 各自落各自的块）；`Err` 级（DB / 配置加载失败）两条通路
//! 本来都跑不了，照旧 `?` 上抛。调度链（`jobs/md_cloud.rs`）每通路独立到点，
//! 用 `round_channel` 只跑自己那一条。
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
/* [0.14.x] 事件流半轮：两条通路共用，只差一个 `Transport`（见文件头）。 */
mod round_stream;
pub mod round_webdav;
mod state;

mod util;

/* 判据与纯函数（`usable_*` / `absorb` / `today` / `should_autosync`）在 `util.rs`：
它们的调用点遍布托盘标签与调度链，这里原样导出，路径不变。 */
pub use util::*;
/* [V0.11.21] 三档的纯判定从 `jobs/md_cloud`（桌面独占）搬到这里：手机端同一条节奏
也要跑，而手机端引用不到桌面模块。判定不碰 IO / Tauri，两端都编。 */
pub mod tier;
/* [V0.11.16] 远端错误的文案表（从 `round_push` 搬出）：「测试连接」的三关也要用同一张。
`pub(crate)` 是为了让 `tests/md_webdav_text.rs` 能直接断言 `fail_text_at` 的关卡分支。 */
pub(crate) mod text;

use sqlx::SqlitePool;

#[cfg(mobile)]
use crate::error::AppError;
use crate::error::AppResult;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync::MdSyncReport;
use crate::models::md_sync_cloud::{MdSyncCloudStatus, MdSyncTestResult, MdSyncViewCloud};
use crate::models::md_sync_config::MdSyncConfig;
use crate::repositories::md_cloud_pending;
use crate::services::md_sync;
use crate::services::md_sync::decision::ConflictMode;

/// 一轮云端同步的结果。`pending` 只对 `Webdav` 有意义（本地目录通道写进去就算同步完了）。
pub struct CloudRoundOutcome {
    pub report: MdSyncReport,
    pub pending: Vec<String>,
    pub today: String,
}

/// 手机端拿到 folder 通路 enabled 时的口径（[V0.11.14] 修 O12）。
///
/// 与 `commands::md_sync_cmd` 的 `NO_BACKUP` 同一口径：能力不在这端，就用既有错误码
/// `MD_SYNC_CONFIG_INVALID` 回一句**用户能照做**的话，不新增错误码。
#[cfg(mobile)]
const NO_LOCAL_FOLDER_ON_MOBILE: &str = "手机端不支持「本地同步」通路：请把云端同步改成 WebDAV（本地目录要靠电脑上的网盘客户端同步，手机上写不进去）";

/// 一轮完整同步（含 Obsidian 落点）。两条通路都不可用时与 `md_sync::run_with` 等价（模式由调用方给）。
///
/// 前台入口（保存 / 手动 / 托盘）：Obsidian 落点冲突走 `Awaiting`（能弹窗）。
pub async fn round(pool: &SqlitePool) -> AppResult<CloudRoundOutcome> {
    round_with(pool, ConflictMode::Awaiting).await
}

/// 由调用方指定 Obsidian 落点冲突处理模式的完整一轮（后台轮用 `Pending`）。
///
/// [V0.11.26] 双通路：folder 在前（零网络、快、失败面小），webdav 在后；
/// 各自独立判可用、独立记错（`absorb` 合报告）。Obsidian 半轮（`md_sync::run_with`）
/// 在两条通路各自的 `round_*::run` 内部各跑一次——与设计 §1.3 的分派图一致。
pub async fn round_with(pool: &SqlitePool, mode: ConflictMode) -> AppResult<CloudRoundOutcome> {
    let config = md_sync::config::load(pool).await?;
    /* 手机端不支持 folder 通路（[V0.11.14] 修 O12）。那条路假设用户电脑上有个网盘
    客户端在同步一个真实目录，手机上既没有那个目录也没有客户端。读时物化会把老
    `localfolder` 配置折算成 folder.enabled=true，这里是兜底：升级前存下的配置、
    或别的入口写进来的配置，都不会再走进那条死路。 */
    #[cfg(mobile)]
    if config
        .cloud_folder
        .as_ref()
        .is_some_and(|channel| channel.enabled)
    {
        return Err(AppError::md_sync_config_invalid(NO_LOCAL_FOLDER_ON_MOBILE));
    }
    let folder = usable_folder(&config);
    let webdav = usable_webdav(&config);
    if folder.is_none() && webdav.is_none() {
        /* 老配置这条路**连 pending 表都不读**：它没有云端，`pending` 填空是事实。 */
        let today = today();
        let report = md_sync::run_with(pool, mode).await?;
        return Ok(CloudRoundOutcome {
            report,
            pending: Vec::new(),
            today,
        });
    }
    let today = today();
    let mut report = MdSyncReport::new(crate::platform::clock::now_ms());
    if let Some(channel) = folder {
        let part = round_folder::run(pool, channel, mode).await?;
        absorb(&mut report, part);
    }
    if let Some(channel) = webdav {
        let part = round_webdav::run(pool, channel, mode).await?;
        absorb(&mut report, part);
    }
    let pending = md_cloud_pending::pending_dates(pool, PurgeChannel::Webdav)
        .await
        .unwrap_or_default();
    Ok(CloudRoundOutcome {
        report,
        pending,
        today,
    })
}

/// 调度链专用：只跑**一条**通路的轮（该通路自己的 Obsidian 半轮包含在内）。
///
/// 通路不可用时什么也不做（返回空报告）：调度链在 `decide` 之前已判过可用，
/// 这里只是防御「判据两次读取之间配置被改」。不回落 `md_sync::run`——那会让
/// 「folder 到点但 folder 恰好被关掉」的一轮偷偷跑一次 Obsidian 半轮。
pub async fn round_channel(
    pool: &SqlitePool,
    channel: PurgeChannel,
) -> AppResult<CloudRoundOutcome> {
    let config = md_sync::config::load(pool).await?;
    let today = today();
    let mut report = MdSyncReport::new(crate::platform::clock::now_ms());
    let mut pending = Vec::new();
    match channel {
        PurgeChannel::Folder => {
            if let Some(ch) = usable_folder(&config) {
                let part = round_folder::run(pool, ch, ConflictMode::Pending).await?;
                absorb(&mut report, part);
            }
        }
        PurgeChannel::Webdav => {
            if let Some(ch) = usable_webdav(&config) {
                let part = round_webdav::run(pool, ch, ConflictMode::Pending).await?;
                absorb(&mut report, part);
                pending = md_cloud_pending::pending_dates(pool, channel)
                    .await
                    .unwrap_or_default();
            }
        }
    }
    Ok(CloudRoundOutcome {
        report,
        pending,
        today,
    })
}

/// 手动入口（「立即同步」命令 / 托盘那一项）的**唯一**包装。
///
/// [V0.11.19] 抽出来是为了让「点一次立即同步 → 解除清理暂停」只有一个挂载点。
/// [V0.11.26] 双通路各 resume 各的：两条通路的失败现场互不合并，暂停也互不牵连。
/// 退出前那一轮（`tray_quit`）走自己的路径，不从这里进。
pub async fn round_manual(pool: &SqlitePool) -> AppResult<CloudRoundOutcome> {
    /* 暂停是「连续 3 个自然日失败」，解除它必须有人明确表达「现在就再试一次」。 */
    purge::resume(pool, PurgeChannel::Folder).await?;
    purge::resume(pool, PurgeChannel::Webdav).await?;
    round(pool).await
}

/// 轮询用：只有「值得广播一次」时才返回 `Some`——导入了数据（老口径）、本轮有远端错误
/// （设置页要能看到它失败过）、待传清单变了。只看 `touched()` 会让「一整天的 401」
/// 在界面上完全无声。
pub async fn tick(pool: &SqlitePool) -> AppResult<Option<MdSyncReport>> {
    let config = md_sync::config::load(pool).await?;
    if usable_folder(&config).is_none() && usable_webdav(&config).is_none() {
        /* 老配置：逐字转交，包括它的 `Some/None` 口径。 */
        return md_sync::tick(pool).await;
    }
    let before = md_cloud_pending::pending_dates(pool, PurgeChannel::Webdav)
        .await
        .unwrap_or_default();
    let outcome = round_with(pool, ConflictMode::Pending).await?;
    let changed =
        outcome.report.touched() || !outcome.report.errors.is_empty() || outcome.pending != before;
    Ok(changed.then_some(outcome.report))
}

/// 设置页要的某一条通路的状态。正文在 `state`（读侧投影，不是分派判据）。
pub async fn status(pool: &SqlitePool, channel: PurgeChannel) -> AppResult<MdSyncCloudStatus> {
    state::status_for(pool, channel).await
}

/// 设置页一次拿全：基础视图 + 两块状态（`#[serde(flatten)]`，不改 `MdSyncView`）。
pub async fn view(pool: &SqlitePool) -> AppResult<MdSyncViewCloud> {
    state::view(pool).await
}

/// 保存前的路径校验（运行时兜底）：复用模型那一份，不在这里重写一遍比对。
pub fn check_paths(config: &MdSyncConfig) -> Result<(), String> {
    if let Some(channel) = &config.cloud_folder {
        channel.validate_folder(&config.bindings)?;
    }
    if let Some(channel) = &config.cloud_webdav {
        channel.validate_webdav()?;
    }
    if let Some(cloud) = &config.cloud {
        cloud.validate(&config.bindings)?;
    }
    Ok(())
}

/// 「测试连接」。正文在 `probe`（它要建临时探针文件，不占这里的判据预算）。
pub async fn test_connection(
    pool: &SqlitePool,
    config: &MdSyncConfig,
    secret: Option<&str>,
) -> AppResult<MdSyncTestResult> {
    probe::test_connection(pool, config, secret).await
}
