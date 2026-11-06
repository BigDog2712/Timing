//! 手机端 Markdown 同步轮询。
//!
//! 与桌面同一套间隔配置（`MdSyncConfig::pollSecs`，默认 15 分钟），差别在每轮要做的是
//! 「镜像进 → 合并 → 写回」——这三步在 `app::md_sync_mobile::sync_once`，本任务只管定时
//! 与广播，符合 `jobs` 不直接碰 `repositories` 的约定。
//!
//! 失败**基本都静默**：没选目录、授权被撤、用户把总开关关了，这些都会让每轮返回错误，
//! 但它们是「还没配好」，不是故障。把这类错误每秒刷进日志只会淹掉真正的问题。
//! 配置类错误（标题为空之类）由手动同步那条路径展示给用户。

use std::time::Duration;

use tauri::{AppHandle, Manager};

use crate::app::{events, md_sync_mobile};
use crate::services::md_sync;
use crate::state::AppState;

/// 启动手机端 Markdown 同步轮询。首轮立即执行，让启动前改过的文件尽快回灌。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let pool = app.state::<AppState>().pool.clone();
            match md_sync_mobile::sync_once(&app).await {
                Ok(report) if report.touched() => events::emit_md_sync_changed(&app, &report),
                Ok(_) => {}
                Err(err) => {
                    let text = err.to_string();
                    /* 「未授权」「没启用落点」都是还没配好，不是故障；见模块注释。 */
                    let expected = text.contains("未授权") || text.contains("没有启用任何落点");
                    if !expected {
                        crate::log_warn!("md sync (mobile) failed: {text}");
                    }
                }
            }
            let secs = md_sync::poll_secs(&pool).await;
            tokio::time::sleep(Duration::from_secs(secs)).await;
        }
    });
}
