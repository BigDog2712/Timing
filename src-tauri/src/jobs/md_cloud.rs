//! 云端自动同步三档链（V0.11.19 批 1，设计 §4.1 / §4.3 / §4.4）。
//!
//! 与 `jobs/md_sync.rs` **解耦**：md 链只调 `md_sync::run`（写 Obsidian 那份），
//! 本链才调 `md_cloud::round`（本地那份 + 云端落点）。`round` 内部本来就会再跑一次
//! `md_sync::run`（`round_webdav.rs` / `round_folder.rs`），所以本链不会漏掉本地那一步。
//! 反过来说，写 md 的频率不再驱动云端节奏 —— 用户在 Obsidian 里每改一个字就往网盘
//! 传一次，正是 PRD §3.4 要停掉的事。
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
//! ## 两条链互撞
//!
//! 与 md 链、托盘点击共用 `tray_sync::try_acquire()`。云链抢不到就跳过这一轮、
//! 等自己的下一个触发点；**不排队、不 sleep 重试**（§14 第 8 条）。云链晚一轮是零代价，
//! 抢闸却会破坏 `Gate` 的复位语义。
//!
//! 通道 = 只用本地 / 云端没填全 / 总开关关闭时，`usable()` 为 `None`，本链**整轮不跑**：
//! 不调 `round`、不写任何 KV、连日志都不刷。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::models::constants::{MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_SMART_MAX_SECS};
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::platform::clock::now_ms;
use crate::services::{md_cloud, md_sync};
use crate::state::AppState;

/* [V0.11.21] 三个名字搬到 `services/md_cloud/tier.rs`——手机端也要按同一套节奏跑，
   而本模块是 `#[cfg(desktop)]`（靠 `tray_sync::try_acquire()` 防重入）。判定不碰 IO，
   放 services 里两端都编、`tests/` 也够得着。

   `pub(crate) use` 而不是改所有引用点：`tests/md_cloud_tier.rs` 与 `qa_batch1_edges.rs`
   写的是 `crate::jobs::md_cloud::{decide, TierState, TierReason}`，转出后一个字都不用改。 */
pub(crate) use crate::services::md_cloud::tier::{decide, TierReason, TierState};

/// 老配置没有 `auto` 键 → 智能 + 15 分钟；越界的分钟数在 `interval_secs()` 里夹。
fn auto_of(config: &MdSyncConfig) -> MdCloudAuto {
    config
        .cloud
        .as_ref()
        .and_then(|cloud| cloud.auto.clone())
        .unwrap_or_default()
}

/// 启动云端三档链。桌面独占：`tray_sync` 是 `#[cfg(desktop)]`。
pub fn spawn(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tier = TierState {
            startup_ms: now_ms(),
            ..TierState::default()
        };
        let mut prev_schedule: Option<CloudSchedule> = None;
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
            /* 「云端会不会跑一轮」只认 `usable`（唯一出口），并且总开关也必须是开的：
               总开关关着时 `round` 里的本地那半会早退，但云端那半仍会写文件 —— 那会
               打破 C5「零文件 IO」。不可用时整轮跳过：不调 round、不写 KV、不刷日志。 */
            if config.enabled && md_cloud::usable(&config).is_some() {
                let auto = auto_of(&config);
                /* 切档时计时器从「现在」起算（PRD §3.4 边界表）：只记一次锚点，
                   不动 `interval_minutes` —— 切档不重置用户填过的分钟数（H-2）。 */
                if prev_schedule != Some(auto.schedule) {
                    if prev_schedule.is_some() {
                        tier.last_attempt_ms = Some(now);
                        tier.startup_done = true;
                    }
                    prev_schedule = Some(auto.schedule);
                }
                if let Some(reason) = decide(
                    &tier,
                    auto.schedule,
                    auto.interval_secs(),
                    now,
                    md_sync::dirty::last_write_ms(),
                ) {
                    /* 抢不到闸 → 本轮跳过，等下一个触发点；不排队、不 sleep 重试。 */
                    if let Some(_gate) = crate::app::tray_sync::try_acquire() {
                        let next_in = match reason {
                            TierReason::Interval => auto.interval_secs(),
                            TierReason::Max => MD_CLOUD_SMART_MAX_SECS,
                            TierReason::Idle | TierReason::Startup => MD_CLOUD_SMART_IDLE_SECS,
                        };
                        crate::log_info!(
                            "md cloud tier: schedule={} next_in={}",
                            auto.schedule.label(),
                            next_in
                        );
                        let outcome = md_cloud::round(&pool).await;
                        tier.last_attempt_ms = Some(now_ms());
                        tier.startup_done = true;
                        match outcome {
                            Ok(round) if round.report.errors.is_empty() => {
                                tier.last_success_ms = Some(now_ms());
                            }
                            Ok(round) => {
                                crate::log_warn!(
                                    "md cloud tier: round finished with errors: {}",
                                    round.report.errors.join("；")
                                );
                            }
                            Err(err) => crate::log_warn!("md cloud tier: round failed: {err}"),
                        }
                    }
                }
            }
            /* 1 秒观察圈：三档最细的判定粒度是「分钟」，没必要跟 md 链挤 200ms。 */
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    });
}
