//! 手机端 Markdown 同步轮询。
//!
//! ## [V0.11.22] 只剩云端一条路
//!
//! 本地日记目录（SAF）那条通路下线后，这里的两套节奏塌成一套：
//!
//! ```text
//! 云端可用（plan_of → Cloud） → 按三档（关闭 / 定时 N / 智能），纯判定在 services::md_cloud::tier
//! 否则（Legacy）             → 什么都不跑，60 秒一醒只等配置变化
//! ```
//!
//! `Legacy` 不再跑一轮，是这一轮最容易被漏掉的一处：v0.11.21 之前它按 `pollSecs` 跑
//! `sync_once`（那会儿 `sync_once` 还会回落 SAF 三步）。界面下线而调度不改，表现是
//! 「开关关着，后台还在传/还在报错」——v0.11.21 在三档上刚踩过同型的坑，这里一并钉住。
//! 判据是纯函数 `mobile_rounds(&plan)`（`services` 里，桌面用例也够得着）。
//!
//! ## 与桌面刻意不同的两处
//!
//! 1. **没有 `tray_sync::try_acquire()`**：那是桌面原生托盘的防重入闸，手机上没有。
//!    手动「立即同步」与自动那轮理论可并发——v0.11.8 起就如此，本轮不扩大；
//! 2. **非云端也按 60 秒粒度醒来**：只为了让「刚在设置里填好云端」尽快生效，
//!    而不是等一个旧周期睡完。
//!
//! 失败**基本都静默**：没填完、开关关着这些是「还没配好」，不是故障。把这类错误每秒刷进
//! 日志只会淹掉真正的问题；配置类错误的原文由手动同步那条路径展示给用户。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app::{events, md_sync_mobile};
use crate::models::md_sync_auto::CloudSchedule;
use crate::platform::clock::now_ms;
use crate::services::md_cloud::tier::{decide, mobile_rounds, plan_of, SyncPlan, TierState};
use crate::services::md_sync;
use crate::state::AppState;

/// 非云端（= 手机上不会同步）时的醒来间隔：见文件头「与桌面刻意不同的两处」第 2 条。
const LEGACY_OBSERVE_SECS: u64 = 60;

/// 跑一轮并播报。返回值 = 「这一轮干净成功了吗」（没有任何 `report.errors`）——
/// 智能档用它判「这一串写已经被传过了」，所以**不能**用「有没有广播」代替：
/// 没有改动的一轮同样算成功，但它不广播。
async fn run_round(app: &AppHandle) -> bool {
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
            /* 「只同步云端」= 配好之前的那句话（用户刚把云端清空、或还在填）。
            它不是故障，别按分钟刷日志；真故障的原文一律留下。 */
            if !text.contains("只同步云端") {
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
                /* [V0.11.22] 手机端只走云端：这一档什么都不跑（见文件头）。
                `mobile_rounds` 是这条规则的唯一出口，桌面用例钉着它。 */
                SyncPlan::Legacy { .. } => {
                    debug_assert!(!mobile_rounds(&plan));
                    /* 切回非云端时把档位记账清掉，下次再开云端仍从「启动轮」起步。 */
                    prev_schedule = None;
                    LEGACY_OBSERVE_SECS
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
                        let clean = run_round(&app).await;
                        tier.last_attempt_ms = Some(now_ms());
                        tier.startup_done = true;
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

    /// 观察窗上限本身是一条判据：它决定「设置改好后多久生效」。改成 1 秒（等于每秒唤醒）
    /// 或改成 900 秒（改设置要等 15 分钟）都会让文件头那条说明变成假话。
    #[test]
    fn legacy_observe_window_stays_at_one_minute() {
        assert_eq!(LEGACY_OBSERVE_SECS, 60);
    }
}
