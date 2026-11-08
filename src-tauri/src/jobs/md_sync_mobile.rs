//! 手机端 Markdown 同步轮询。
//!
//! 与桌面同一套配置，差别只在一轮要做的是「镜像进 → 合并 → 写回」
//! （`app::md_sync_mobile::sync_once`，本任务只管定时与广播，符合 `jobs` 不直接碰
//! `repositories` 的约定）。
//!
//! ## 两套节奏（[V0.11.21]）
//!
//! 判据在 `services::md_cloud::tier::plan_of`，**不在这里重写**：
//!
//! ```text
//! 云端可用 → 按三档（关闭 / 定时 N / 智能），纯判定是同文件的 `decide`
//! 否则     → 沿用 `pollSecs`（默认 900 秒），与 v0.11.20 逐字相同
//! ```
//!
//! 为什么非云端不一起改用三档：`pollSecs` 是 v0.11.3 的老字段，语义是「md 文件轮询
//! 间隔」，用它反推档位会凭空造出「定时 3 分钟」这种谁都没选过的档。老用户的行为
//! 必须一个字节都不变。
//!
//! ## 两处与桌面刻意不同
//!
//! 1. **没有 `tray_sync::try_acquire()`**：那是桌面原生托盘的防重入闸，手机上没有。
//!    代价是手动「立即同步」与自动那轮理论上可并发——v0.11.8 起就如此，本轮不扩大；
//! 2. **非云端也按 ≤60 秒的粒度醒来**（不是一次睡满 `poll_secs`）：只在设置里把间隔
//!    改小时才有区别（改完最多一分钟生效，而不是等旧周期睡完）。跑不跑仍只看
//!    `pollSecs`，所以「多久同步一次」这个可观察行为没变。
//!
//! 失败**基本都静默**：没选目录、授权被撤、用户把总开关关了，这些都会让每轮返回错误，
//! 但它们是「还没配好」，不是故障。把这类错误每秒刷进日志只会淹掉真正的问题。
//! 配置类错误（标题为空之类）由手动同步那条路径展示给用户。

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::{events, md_sync_mobile};
use crate::models::md_sync_auto::CloudSchedule;
use crate::platform::clock::{elapsed_since_ms, now_ms};
use crate::services::md_cloud::tier::{decide, plan_of, SyncPlan, TierState};
use crate::services::md_sync;
use crate::state::AppState;

/// 非云端那一档的观察窗上限：见文件头「两处与桌面刻意不同」第 2 条。
const LEGACY_OBSERVE_SECS: u64 = 60;

/// 云端模式是否生效。与 `sync_once` 用**同一个判据**（`md_cloud::usable`），不在这里
/// 重写一遍 `enabled && is_usable()`。
async fn cloud_ready(pool: &SqlitePool) -> bool {
    md_sync::config::load(pool)
        .await
        .map(|config| crate::services::md_cloud::usable(&config).is_some())
        .unwrap_or(false)
}

/// 跑一轮并播报。返回值 = 「这一轮干净成功了吗」（没有任何 `report.errors`）——
/// 智能档用它判「这一串写已经被传过了」，所以**不能**用「有没有广播」代替：
/// 没有改动的一轮同样算成功，但它不广播。
async fn run_round(app: &AppHandle, cloud_ready: bool) -> bool {
    match md_sync_mobile::sync_once(app).await {
        Ok(report) => {
            /* [V0.11.13] 云端那轮的失败落在 `report.errors` 里（编排层不把
            「这次传不上去」折成 Err，否则一整轮部分成功的同步会被报成失败）。
            它自己没有别的出口：手机端排查只有 `adb logcat -s Timing`。 */
            if !report.errors.is_empty() {
                crate::log_warn!("md sync (mobile) 本轮错误：{}", report.errors.join("；"));
            }
            if report.touched() {
                events::emit_md_sync_changed(app, &report);
            }
            report.errors.is_empty()
        }
        Err(err) => {
            let text = err.to_string();
            /* 「没启用落点」是还没配好，不是故障。
            [V0.11.13] 「未授权」只在**非云端**路径上可能（云端那轮根本不查 SAF，
            见 `app::md_sync_mobile::sync_once`），所以这条豁免必须跟着云端状态走：
            云端模式下还留着它，就等于把唯一的真故障静默成一行都不打。 */
            let expected = text.contains("没有启用任何落点")
                || (text.contains("未授权") && !cloud_ready);
            if !expected {
                crate::log_warn!("md sync (mobile) failed: {text}");
            }
            false
        }
    }
}

/// 启动手机端 Markdown 同步轮询。首轮立即执行，让启动前改过的文件尽快回灌。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut tier = TierState {
            startup_ms: now_ms(),
            ..TierState::default()
        };
        /* 非云端的锚点：`None` = 还没跑过 → 首轮立即跑（与 v0.11.20 同）。
           两条链共用它做「距上一轮多久」的记账，切换规划时不会凭空多跑一轮。 */
        let mut last_round_ms: Option<i64> = None;
        let mut prev_schedule: Option<CloudSchedule> = None;
        loop {
            let pool = app.state::<AppState>().pool.clone();
            let now = now_ms();
            let config = match md_sync::config::load(&pool).await {
                Ok(config) => config,
                Err(err) => {
                    crate::log_warn!("md sync (mobile) load config failed: {err}");
                    tokio::time::sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
            let plan = plan_of(&config);
            let secs = match plan {
                SyncPlan::Legacy { poll_secs } => {
                    /* 切回非云端时把档位记账清掉，下次再开云端仍从「启动轮」起步。 */
                    prev_schedule = None;
                    let due = match last_round_ms {
                        None => true,
                        Some(at) => elapsed_since_ms(now, at) >= (poll_secs * 1000) as i64,
                    };
                    if due {
                        run_round(&app, false).await;
                        last_round_ms = Some(now_ms());
                    }
                    /* 剩余时间按 ≤60 秒的粒度看（见文件头第 2 条），至少睡 1 秒。 */
                    let anchor = last_round_ms.unwrap_or(now);
                    let elapsed = elapsed_since_ms(now_ms(), anchor).max(0) as u64;
                    (poll_secs.saturating_sub(elapsed / 1000)).clamp(1, LEGACY_OBSERVE_SECS)
                }
                SyncPlan::Cloud { auto } => {
                    /* 切档时计时器从「现在」起算（与桌面 `jobs::md_cloud` 同口径）：
                       只记一次锚点，不动 `interval_minutes` —— 切档不重置用户填过的分钟数。 */
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
                        crate::log_info!(
                            "md sync (mobile) tier: schedule={} reason={:?}",
                            auto.schedule.label(),
                            reason
                        );
                        let clean = run_round(&app, true).await;
                        tier.last_attempt_ms = Some(now_ms());
                        tier.startup_done = true;
                        last_round_ms = Some(now_ms());
                        if clean {
                            tier.last_success_ms = Some(now_ms());
                        }
                    }
                    /* 三档最细的判定粒度是「分钟」，1 秒观察圈与桌面一致。 */
                    1
                }
            };
            tokio::time::sleep(Duration::from_secs(secs)).await;
        }
    });
}

#[cfg(test)]
mod tests {
    use super::LEGACY_OBSERVE_SECS;

    /// 观察窗上限本身是一条判据：它决定「设置改小多久后生效」，也决定老用户的唤醒
    /// 频率。改成 1 秒（等于每秒唤醒）或改成 poll_secs（等于改设置要等 15 分钟）
    /// 都会让文件头那两条说明变成假话。
    #[test]
    fn legacy_observe_window_stays_at_one_minute() {
        assert_eq!(LEGACY_OBSERVE_SECS, 60);
    }
}
