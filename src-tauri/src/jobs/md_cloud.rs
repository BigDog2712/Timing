//! 云端自动同步三档链（V0.11.19 批 1，设计 §4.1 / §4.3 / §4.4；V0.11.26 双通路，设计 §1.3）。
//!
//! 与 `jobs/md_sync.rs` **解耦**：md 链只调 `md_sync::run`（写 Obsidian 那份），
//! 本链才调 `md_cloud`（云端落点 + 各通路自己那半 Obsidian）。
//!
//! ## 三档
//!
//! - `关闭`：不装定时器，只剩「立即同步 / 托盘 / 保存并同步」三个手动入口（D8）；
//! - `定时`：每 N 分钟一轮，N ∈ [5, 120]，与有无改动无关（D5）；
//! - `智能`：最后一次 SQL 写后静默 300s 一轮（D4）、启动后 60s 一轮（D6）、
//!   距上次成功轮 ≥1800s 且期间有写就一轮（D9）。退出前那一轮是既有 `tray_quit`，不改。
//!
//! 默认 `智能`，**不从 `pollSecs` 反推档位**（PRD §15.2：老值语义不同，反推会得到
//! 「定时 3 分钟」这种谁都没选过的档）。
//!
//! ## [V0.11.26] 双通路各自到点（R4 / R5）
//!
//! folder / webdav 各持一份 `TierState` 与各自的 `auto`；任一通路到点 → 抢
//! `tray_sync::try_acquire()`（共用一把闸，抢不到跳过本轮、不排队不重试——既有口径）
//! → `round_channel(pool, 该通路)` 只跑自己那一条。同一秒双通路到点时后到者跳过，
//! 等下一个触发点（设计 §四 3 的默认口径）。
//!
//! 通路 = 没填全 / 总开关关闭时，`usable_folder / usable_webdav` 为 `None`，
//! 那条通路**整轮不跑**：不调 round、不写任何 KV、连日志都不刷。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::models::constants::{MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_SMART_MAX_SECS};
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::platform::clock::now_ms;
use crate::services::{md_cloud, md_sync};
use crate::state::AppState;

/* [V0.11.21] 三个名字搬到 `services/md_cloud/tier.rs`——手机端也要按同一套节奏跑，
   而本模块是 `#[cfg(desktop)]`（靠 `tray_sync::try_acquire()` 防重入）。判定不碰 IO，
   放 services 里两端都编、`tests/` 也够得着。

   `pub(crate) use` 而不是改所有引用点：`tests/md_cloud_tier.rs` 与 `qa_batch1_edges.rs`
   写的是 `crate::jobs::md_cloud::{decide, TierState, TierReason}`，转出后一个字都不用改。 */
pub(crate) use crate::services::md_cloud::tier::{decide, TierReason, TierState};

/// 一条通路自己的调度记账（[V0.11.26]：双通路 = 双份，互不干扰）。
struct ChannelTier {
    tier: TierState,
    prev_schedule: Option<CloudSchedule>,
}

impl Default for ChannelTier {
    fn default() -> Self {
        Self {
            tier: TierState {
                startup_ms: now_ms(),
                ..TierState::default()
            },
            prev_schedule: None,
        }
    }
}

/// 通路自己的三档；没有这个键 → 智能 + 15 分钟（与 `plan_of` 同口径）。
fn auto_of(channel: Option<&MdSyncCloudChannel>) -> MdCloudAuto {
    channel
        .and_then(|channel| channel.auto.clone())
        .unwrap_or_default()
}

/// 启动云端三档链。桌面独占：`tray_sync` 是 `#[cfg(desktop)]`。
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut states = [ChannelTier::default(), ChannelTier::default()];
        loop {
            let pool = app.state::<AppState>().pool.clone();
            let now = now_ms();
            let config = match md_sync::config::load(&pool).await {
                Ok(config) => config,
                Err(err) => {
                    crate::log_warn!("md cloud tier: load config failed: {err}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            if config.enabled {
                for (index, channel) in [PurgeChannel::Folder, PurgeChannel::Webdav]
                    .into_iter()
                    .enumerate()
                {
                    /* 「这条通路会不会跑」只认 `usable_*`（唯一出口），并且总开关也必须是开的：
                       总开关关着时 `round` 里的本地那半会早退，但云端那半仍会写文件。 */
                    let usable = match channel {
                        PurgeChannel::Folder => md_cloud::usable_folder(&config),
                        PurgeChannel::Webdav => md_cloud::usable_webdav(&config),
                    };
                    let Some(channel_cfg) = usable else { continue };
                    let state = &mut states[index];
                    let auto = auto_of(Some(channel_cfg));
                    /* 切档时计时器从「现在」起算（PRD §3.4 边界表）：只记一次锚点，
                       不动 `interval_minutes` —— 切档不重置用户填过的分钟数（H-2）。 */
                    if state.prev_schedule != Some(auto.schedule) {
                        if state.prev_schedule.is_some() {
                            state.tier.last_attempt_ms = Some(now);
                            state.tier.startup_done = true;
                        }
                        state.prev_schedule = Some(auto.schedule);
                    }
                    if let Some(reason) = decide(
                        &state.tier,
                        auto.schedule,
                        auto.interval_secs(),
                        now,
                        md_sync::dirty::last_write_ms(),
                    ) {
                        /* 抢不到闸 → 本轮跳过，等下一个触发点；不排队、不 sleep 重试。
                           双通路同秒到点时后到者同此口径（设计 §四 3）。 */
                        if let Some(_gate) = crate::app::tray_sync::try_acquire() {
                            let next_in = match reason {
                                TierReason::Interval => auto.interval_secs(),
                                TierReason::Max => MD_CLOUD_SMART_MAX_SECS,
                                TierReason::Idle | TierReason::Startup => {
                                    MD_CLOUD_SMART_IDLE_SECS
                                }
                            };
                            crate::log_info!(
                                "md cloud tier: channel={} schedule={} next_in={}",
                                channel.as_str(),
                                auto.schedule.label(),
                                next_in
                            );
                            let outcome = md_cloud::round_channel(&pool, channel).await;
                            state.tier.last_attempt_ms = Some(now_ms());
                            state.tier.startup_done = true;
                            match outcome {
                                Ok(round) if round.report.errors.is_empty() => {
                                    state.tier.last_success_ms = Some(now_ms());
                                }
                                Ok(round) => {
                                    crate::log_warn!(
                                        "md cloud tier: round finished with errors: {}",
                                        round.report.errors.join("；")
                                    );
                                }
                                Err(err) => {
                                    crate::log_warn!("md cloud tier: round failed: {err}")
                                }
                            }
                        }
                    }
                }
            }
            /* 1 秒观察圈：三档最细的判定粒度是「分钟」，没必要跟 md 链挤 200ms。 */
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}
