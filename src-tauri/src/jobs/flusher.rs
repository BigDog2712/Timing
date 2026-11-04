//! 后台周期落盘（每 15s）。
//!
//! 计时运行中把已计秒数折入 accumulated_sec 并推进 running_since，
//! 保证崩溃后丢失 ≤ 2 个间隔（≤30s，AC-14 / Spec §6.3）。
//! 定时器基于 tokio `interval`（单调），与瞬时 wall-clock 抖动解耦。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::models::constants::FLUSH_INTERVAL_SECS;
use crate::services;
use crate::state::AppState;

/// 启动落盘后台任务。
pub fn spawn_flusher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(FLUSH_INTERVAL_SECS));
        ticker.tick().await; // 消耗首次立即触发
        loop {
            ticker.tick().await;
            let pool = app.state::<AppState>().pool.clone();
            if let Err(err) = services::timer::flush_active(&pool).await {
                crate::log_warn!("flush_active failed: {err}");
            }
        }
    });
}
