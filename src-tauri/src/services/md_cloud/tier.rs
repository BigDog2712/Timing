//! 云端三档的**纯判定**（V0.11.19 批 1 落在 `jobs/md_cloud.rs`；V0.11.21 搬到本文件）。
//!
//! 搬家的理由只有一个：手机端也要按三档跑，而 `jobs/md_cloud` 是 `#[cfg(desktop)]`
//! （它靠 `tray_sync::try_acquire()` 防重入，那是原生托盘的东西）。判定本身不碰 IO、
//! 不碰全局静态、不碰 Tauri，放在 `services` 里两端都能编、`tests/` 里的桌面用例也够得着。
//!
//! `jobs/md_cloud.rs` 用 `pub(crate) use` 把这三个名字转出去，所以
//! `md_cloud_tier.rs` / `qa_batch1_edges.rs` 那些既有用例的路径**一个字都不用改**。
//!
//! ## 三档
//!
//! - `关闭`：不装定时器，只剩手动入口；
//! - `定时`：每 N 分钟一轮，N ∈ [5, 120]，与有无改动无关；
//! - `智能`：最后一次业务写后静默 300s 一轮、启动后 60s 一轮、
//!   距上次成功轮 ≥1800s 且期间有写就一轮。
//!
//! 默认 `智能`，**不从 `pollSecs` 反推档位**（老值语义不同，反推会得到「定时 3 分钟」
//! 这种谁都没选过的档）。

use crate::models::constants::{
    MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_SMART_MAX_SECS, MD_CLOUD_STARTUP_DELAY_SECS,
};
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::models::md_sync_config::MdSyncConfig;
use crate::platform::clock::elapsed_since_ms;

use super::usable;

/// 一条同步链自己的记账。全是进程内状态，不落 KV ——「云端不可用不写任何 KV」是硬约束。
#[derive(Debug, Clone, Default)]
pub struct TierState {
    /// 进程启动时刻：启动轮与「还没有成功轮」时的 30 分钟上限都从它起算。
    pub startup_ms: i64,
    pub startup_done: bool,
    pub last_attempt_ms: Option<i64>,
    pub last_success_ms: Option<i64>,
}

/// 这一轮为什么跑，只进日志与单测。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TierReason {
    Startup,
    Interval,
    Idle,
    Max,
}

/// 纯判定：本圈该不该跑一轮云端同步。**不碰 IO、不碰全局静态**，可单测。
///
/// `usable` 由调用方判（它要读配置），这里只管「三档的时钟到没到」。
/// `last_write_ms == 0` 表示进程启动以来没有业务写：智能档的 idle / max 都不该因此触发。
pub fn decide(
    state: &TierState,
    schedule: CloudSchedule,
    interval_secs: u64,
    now: i64,
    last_write_ms: i64,
) -> Option<TierReason> {
    if schedule == CloudSchedule::Off {
        return None;
    }
    /* 启动轮：避开启动期托盘 / 配置 / 网络的竞态。档位 ≠ 关闭都有一次。
       跑完之后 `last_attempt_ms` 会被记为这一轮，定时档的 N 分钟从此处起算 —— 这样
       「相邻两次上传 ≈ N 分钟」仍然成立，不会变成 60s + N 分钟两段。 */
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
               不加这一条云端会一整天不同步。还没成功过就以启动时刻为基准。 */
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

/// 一条同步链本圈该按哪套节奏判（[V0.11.21] 手机端与桌面共用）。
///
/// 分成两档而不是「统一都用三档」：`pollSecs` 是 v0.11.3 就有的老字段，出厂默认 900 秒，
/// **老用户库里存着的值语义不同**（那是「md 文件的轮询间隔」，与云端三档无关）。用它反推
/// 档位会得到「定时 3 分钟」这种谁都没选过的档，所以非云端配置一律走 `Legacy`，
/// 行为与 v0.11.20 逐字相同。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SyncPlan {
    /// 非云端：沿用 `pollSecs`。
    Legacy { poll_secs: u64 },
    /// 云端可用：按三档判定。
    Cloud { auto: MdCloudAuto },
}

/// 分派判据的**唯一**出口。三条，顺序即优先级：
///
/// 1. 总开关关着 → `Legacy`（此时 `round` 里的本地那半会早退，云端那半也不该跑）；
/// 2. 云端不可用（没配 / 没填全 / `localfolder` 在手机上不成立）→ `Legacy`；
/// 3. 否则 → `Cloud`，档位取 `cloud.auto`，老配置没有这个键时按「智能 + 15」。
pub fn plan_of(config: &MdSyncConfig) -> SyncPlan {
    if !config.enabled || usable(config).is_none() {
        return SyncPlan::Legacy {
            poll_secs: config.poll_secs,
        };
    }
    let auto = config
        .cloud
        .as_ref()
        .and_then(|cloud| cloud.auto.clone())
        .unwrap_or_default();
    SyncPlan::Cloud { auto }
}
