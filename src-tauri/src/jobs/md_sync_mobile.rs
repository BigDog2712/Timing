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

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::{events, md_sync_mobile};
use crate::services::md_sync;
use crate::state::AppState;

/// 云端模式是否生效。与 `sync_once` 用**同一个判据**（`md_cloud::usable`），不在这里
/// 重写一遍 `enabled && is_usable()`。
async fn cloud_ready(pool: &SqlitePool) -> bool {
    md_sync::config::load(pool)
        .await
        .map(|config| crate::services::md_cloud::usable(&config).is_some())
        .unwrap_or(false)
}

/// 启动手机端 Markdown 同步轮询。首轮立即执行，让启动前改过的文件尽快回灌。
pub fn spawn_md_sync_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        loop {
            let pool = app.state::<AppState>().pool.clone();
            match md_sync_mobile::sync_once(&app).await {
                Ok(report) => {
                    /* [V0.11.13] 云端那轮的失败落在 `report.errors` 里（编排层不把
                    「这次传不上去」折成 Err，否则一整轮部分成功的同步会被报成失败）。
                    它自己没有别的出口：手机端排查只有 `adb logcat -s Timing`。 */
                    if !report.errors.is_empty() {
                        crate::log_warn!("md sync (mobile) 本轮错误：{}", report.errors.join("；"));
                    }
                    if report.touched() {
                        events::emit_md_sync_changed(&app, &report);
                    }
                }
                Err(err) => {
                    let text = err.to_string();
                    /* 「没启用落点」是还没配好，不是故障。
                    [V0.11.13] 「未授权」只在**非云端**路径上可能（云端那轮根本不查
                    SAF，见 `app::md_sync_mobile::sync_once`），所以这条豁免必须跟着
                    云端状态走：云端模式下还留着它，就等于把唯一的真故障静默成一行都不打。 */
                    let expected =
                        text.contains("没有启用任何落点")
                            || (text.contains("未授权") && !cloud_ready(&pool).await);
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
