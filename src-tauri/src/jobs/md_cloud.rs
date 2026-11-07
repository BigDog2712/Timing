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

use crate::models::constants::{
    MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_SMART_MAX_SECS, MD_CLOUD_STARTUP_DELAY_SECS,
};
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::platform::clock::{elapsed_since_ms, now_ms};
use crate::services::{md_cloud, md_sync};
use crate::state::AppState;

/// 云端链自己的记账。全是进程内状态，不落 KV —— 「云端不可用不写任何 KV」是硬约束。
#[derive(Debug, Clone, Default)]
pub(crate) struct TierState {
    /// 进程启动时刻：启动轮与「还没有成功轮」时的 30 分钟上限都从它起算。
    pub startup_ms: i64,
    pub startup_done: bool,
    pub last_attempt_ms: Option<i64>,
    pub last_success_ms: Option<i64>,
}

/// 这一轮为什么跑，只进日志与单测。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum TierReason {
    Startup,
    Interval,
    Idle,
    Max,
}

/// 纯判定：本圈该不该跑一轮云端同步。**不碰 IO、不碰全局静态**，可单测。
///
/// `usable` 由调用方判（它要读配置），这里只管「三档的时钟到没到」。
/// `last_write_ms == 0` 表示进程启动以来没有业务写：智能档的 idle / max 都不该因此触发。
pub(crate) fn decide(
    state: &TierState,
    schedule: CloudSchedule,
    interval_secs: u64,
    now: i64,
    last_write_ms: i64,
) -> Option<TierReason> {
    if schedule == CloudSchedule::Off {
        return None;
    }
    /* 启动轮：避开启动期托盘 / 配置 / 网络的竞态。PRD D6 要求「档位 ≠ 关闭」都有一次。
       跑完之后 `last_attempt_ms` 会被记为这一轮，定时档的 N 分钟从此处起算 —— 这样
       D5 的「相邻两次上传 ≈ N 分钟」仍然成立，不会变成 60s + N 分钟两段。 */
    if !state.startup_done
        && elapsed_since_ms(now, state.startup_ms) >= (MD_CLOUD_STARTUP_DELAY_SECS * 1000) as i64
    {
        return Some(TierReason::Startup);
    }

    match schedule {
        CloudSchedule::Off => None,
        CloudSchedule::Interval => {
            let anchor = state.last_attempt_ms.unwrap_or(state.startup_ms);
            (elapsed_since_ms(now, anchor) >= (interval_secs * 1000) as i64)
                .then_some(TierReason::Interval)
        }
        CloudSchedule::Smart => {
            let wrote = last_write_ms > 0;
            /* 失败节流：**任何一轮**（成功或失败）都把下一次尝试推后自己的窗口。
               没有这一条，云端 401 时 `covered` 永远为假，idle 会每秒重发一次网络请求，
               正好撞上「不做重试风暴」那条边界。`last_attempt_ms` 由调用方每轮更新。 */
            let since_attempt =
                elapsed_since_ms(now, state.last_attempt_ms.unwrap_or(state.startup_ms));
            /* ① 停手 5 分钟。`covered` 挡住「这一串写已经由上一次成功轮传过了」。 */
            let idle = wrote
                && elapsed_since_ms(now, last_write_ms) >= (MD_CLOUD_SMART_IDLE_SECS * 1000) as i64;
            let covered = state
                .last_success_ms
                .is_some_and(|ok| ok >= last_write_ms);
            if idle && !covered && since_attempt >= (MD_CLOUD_SMART_IDLE_SECS * 1000) as i64 {
                return Some(TierReason::Idle);
            }
            /* ③ 30 分钟上限：连续工作、每 4 分钟写一次时「5 分钟静默」永远不到达，
               不加这一条云端会一整天不同步（D9）。还没成功过就以启动时刻为基准。 */
            let baseline = state.last_success_ms.unwrap_or(state.startup_ms);
            let max_due =
                elapsed_since_ms(now, baseline) >= (MD_CLOUD_SMART_MAX_SECS * 1000) as i64;
            let wrote_after_baseline = wrote && last_write_ms > baseline;
            if max_due
                && wrote_after_baseline
                && since_attempt >= (MD_CLOUD_SMART_MAX_SECS * 1000) as i64
            {
                return Some(TierReason::Max);
            }
            None
        }
    }
}

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
