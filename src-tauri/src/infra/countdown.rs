//! 倒计时到点后台调度（ADR-011）：`tokio::interval(1s)` 判定到点，归 Rust 的单一事实来源。
//!
//! 每 tick 调 `services::countdown::tick`：若存在「已到点」的倒计时会话 →
//! 发系统通知 + emit `countdown-finished`（前端播铃声）；自动结束开关（AC-62，默认关）
//! 决定会话是否落盘为 `saved`。无倒计时时每 tick 单行查询后早退，开销可忽略。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::infra::{events, notify, tray_menu};
use crate::models::constants::COUNTDOWN_WATCH_INTERVAL_SECS;
use crate::models::timer::CountdownFinished;
use crate::services;
use crate::state::AppState;

/// 启动倒计时到点后台任务。
pub fn spawn_countdown_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(COUNTDOWN_WATCH_INTERVAL_SECS));
        ticker.tick().await; // 消耗首次立即触发
                             // 已处理过的会话 id：通知模式（不自动结束）下避免每 tick 重复通知 / 重复播铃。
        let mut fired: Option<i64> = None;
        loop {
            ticker.tick().await;
            let pool = app.state::<AppState>().pool.clone();
            match services::countdown::tick(&pool).await {
                Ok(Some(out)) => {
                    if fired == Some(out.record.id) {
                        continue;
                    }
                    fired = Some(out.record.id);
                    let body = notify_body(&out.item_name, out.target_sec);
                    let _ = notify::notify(&app, "倒计时结束", &body);
                    if out.ended {
                        // 自动结束：会话转 saved（idle），刷新权威状态 + 托盘。
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
                Ok(None) => fired = None,
                Err(err) => eprintln!("[tickbar] countdown tick failed: {err}"),
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
