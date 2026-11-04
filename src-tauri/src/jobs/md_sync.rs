//! Markdown 双向同步轮询（V0.4.0 / 插件 API v2）。
//!
//! 为什么是轮询而不是 `notify`：
//! - 不新增平台依赖，Windows / macOS / Linux 行为一致；
//! - Obsidian / VS Code 保存时常用「写临时文件再 rename」，文件监听会收到多次事件，
//!   还要自己做去抖；2s 轮询只读目标文件，成本远低于一次编辑器保存；
//! - 同步本身用 `mtime + 基线` 判定，轮询晚 2s 不会丢改动，只会晚一点看到。
//!
//! 任务只负责「定时调用 service + 广播」；所有判定在 `services::md_sync`，符合
//! `jobs` 不直接碰 `repositories` 的分层约定。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::models::constants::MD_SYNC_POLL_SECS;
use crate::services;
use crate::state::AppState;

/// 启动 Markdown 同步轮询。首次 tick 立即执行，让启动前改过的文件尽快回灌。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(MD_SYNC_POLL_SECS));
        loop {
            ticker.tick().await;
            let pool = app.state::<AppState>().pool.clone();
            match services::md_sync::tick(&pool).await {
                Ok(Some(report)) => events::emit_md_sync_changed(&app, &report),
                Ok(None) => {}
                Err(err) => crate::log_warn!("md sync tick failed: {err}"),
            }
        }
    });
}
