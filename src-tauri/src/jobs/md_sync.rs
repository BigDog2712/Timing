//! Markdown 双向同步轮询（V0.4.0；V0.11.3 改为可调间隔；V0.11.5 起不再读插件目录）。
//!
//! 为什么是轮询而不是 `notify`：
//! - 不新增平台依赖，Windows / macOS / Linux 行为一致；
//! - Obsidian / VS Code 保存时常用「写临时文件再 rename」，文件监听会收到多次事件，
//!   还要自己做去抖；
//! - 同步本身用 `mtime + 基线` 判定，轮询晚一点不会丢改动，只会晚一点看到。
//!
//! ## 间隔为什么不再是 2 秒
//!
//! 2 秒轮询的代价不在「读一个文件」，而在每轮都要按天取数、渲染整段区块、比对字符串
//! ——一天下来是几千次全量渲染，换来的只是「改完 2 秒内看到」。用户口径：
//! 「同步要降，默认十五分钟，可以自己调，也能点手动同步」。于是间隔进了配置
//! （`MdSyncConfig::pollSecs`），本任务每轮**重新读一次配置**再决定睡多久。
//!
//! 任务只负责「定时调用 service + 广播」；所有判定在 `services::md_sync`，符合
//! `jobs` 不直接碰 `repositories` 的分层约定。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::services;
use crate::state::AppState;

/// 启动 Markdown 同步轮询。首次 tick 立即执行，让启动前改过的文件尽快回灌。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let pool = app.state::<AppState>().pool.clone();
            /* [V0.11.13] 走云端编排：`cloud` 没配 / 没开 / 没填全时它逐字转交
            `md_sync::tick`，老配置的行为与 V0.11.12 完全一致（判据在
            `services::md_cloud::tick`，不在这里写 if）。 */
            match services::md_cloud::tick(&pool).await {
                Ok(Some(report)) => events::emit_md_sync_changed(&app, &report),
                Ok(None) => {}
                Err(err) => crate::log_warn!("md sync tick failed: {err}"),
            }
            let secs = services::md_sync::poll_secs(&pool).await;
            tokio::time::sleep(Duration::from_secs(secs)).await;
        }
    });
}
