//! 倒计时到点后台调度（ADR-011）：判定到点，归 Rust 的单一事实来源。
//!
//! 节拍策略（v0.3 起）：
//! - 有倒计时在跑 → **1s** 一次（要按时到点，语义不变）；
//! - 空闲 → 每 15 个 tick 才做一次权威校验（`IDLE_RECHECK_TICKS`），其余 tick 直接跳过。
//!
//! 之前空闲时也是每 1s 一次 `find_active` 查询：常驻托盘应用一天 8.6 万次无意义 SQL。
//! 现在用 `services::countdown::active_hint()`（进程内提示位）先挡一层，
//! 但**每 15s 必回库校验一次**，所以提示位漂移最坏 15s 自愈，不会漏掉任何到点。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::infra::{notify, tray_menu};
use crate::models::constants::COUNTDOWN_WATCH_INTERVAL_SECS;
use crate::models::timer::CountdownFinished;
use crate::services;
use crate::state::AppState;

/// 空闲时每隔多少个 tick 做一次权威校验（1s × 15 = 15s）。
const IDLE_RECHECK_TICKS: u32 = 15;

/// 启动倒计时到点后台任务。
pub fn spawn_countdown_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(COUNTDOWN_WATCH_INTERVAL_SECS));
        ticker.tick().await; // 消耗首次立即触发
        let mut idle_ticks: u32 = 0;
        loop {
            ticker.tick().await;
            if !services::countdown::active_hint() {
                idle_ticks = idle_ticks.wrapping_add(1);
                if !idle_ticks.is_multiple_of(IDLE_RECHECK_TICKS) {
                    continue;
                }
            } else {
                idle_ticks = 0;
            }
            let pool = app.state::<AppState>().pool.clone();
            match services::countdown::tick(&pool).await {
                Ok(Some(out)) => {
                    /* [V0.3.4] 到点一律已结束（会话转 saved）→ 下一 tick 查不到 active，
                    因此不需要「已处理过的会话 id」去重：同一个会话只会走到这里一次。 */
                    let body = notify_body(&out.item_name, out.target_sec);
                    let _ = notify::notify(&app, "倒计时结束", &body);
                    if out.ended {
                        // 已结束：刷新权威状态 + 托盘。
                        events::emit_timer_state(&app, &pool).await;
                    }
                    events::emit_countdown_finished(
                        &app,
                        &CountdownFinished {
                            session: out.record,
                            target_sec: out.target_sec,
                        },
                    );
                }
                Ok(None) => {}
                Err(err) => crate::log_warn!("countdown tick failed: {err}"),
            }
        }
    });
}

/// 通知正文：`{事项名} · {MM:SS} 到点`；事项名缺失退化为 `{MM:SS} 到点`。
fn notify_body(item_name: &str, target_sec: i64) -> String {
    let duration = tray_menu::format_duration(target_sec);
    if item_name.trim().is_empty() {
        format!("{duration} 到点")
    } else {
        format!("{item_name} · {duration} 到点")
    }
}
