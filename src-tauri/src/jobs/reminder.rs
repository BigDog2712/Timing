//! 提醒后台调度（ADR-010）：`tokio::interval(15s)` **查询式**扫描，天然抗休眠。
//!
//! 每 tick：查 `items`/`todos` 中 `remind_at <= now AND reminded_at IS NULL` 的行 →
//! 先批量置位 `reminded_at`（去重，K-19）→ 发系统通知（同一 tick 内多条聚合，AC-61）→
//! 逐条 emit `reminder-fired`。通知失败则回滚 `reminded_at`（下一 tick 重试，绝不静默丢提醒）。

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::error::AppResult;
use crate::infra::notify;
use crate::models::constants::REMINDER_SCAN_INTERVAL_SECS;
use crate::models::reminder::Reminder;
use crate::platform::clock::now_ms;
use crate::services;
use crate::state::AppState;

/// 聚合正文里最多列出的标题数（超出折叠为「… 等」，AC-61）。
const AGGREGATE_TITLE_LIMIT: usize = 3;

/// 启动提醒调度后台任务（与既有 15s flusher 并行的独立 tokio 任务）。
pub fn spawn_reminder_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(REMINDER_SCAN_INTERVAL_SECS));
        ticker.tick().await; // 消耗首次立即触发
        loop {
            ticker.tick().await;
            let pool = app.state::<AppState>().pool.clone();
            if let Err(err) = scan_once(&app, &pool).await {
                crate::log_warn!("reminder scan failed: {err}");
            }
        }
    });
}

/// 单次扫描（查询式，非累计式 → 休眠唤醒后一次补齐所有逾期提醒）。
async fn scan_once(app: &AppHandle, pool: &SqlitePool) -> AppResult<()> {
    let now = now_ms();
    let due = services::reminder::due(pool, now).await?;
    if due.is_empty() {
        return Ok(());
    }
    // ① 先置位：保证一条提醒只弹一次、崩溃重启不重弹（K-19）。
    services::reminder::mark_fired(pool, &due, now).await?;
    // ② 系统通知（多条聚合为一条，AC-61）。
    if !send_notification(app, &due) {
        // 通知失败回滚，保留下次重试；应用内事件仍照常发（可视兜底不依赖系统通知）。
        services::reminder::reset_fired(pool, &due).await?;
    }
    // ③ 应用内事件（前端高亮对应行 / 刷新铃铛态）。
    for reminder in &due {
        events::emit_reminder_fired(app, reminder);
    }
    Ok(())
}

/// 发送通知：单条用目标标题；多条聚合为一条（AC-61）。
fn send_notification(app: &AppHandle, due: &[Reminder]) -> bool {
    if let [single] = due {
        return notify::notify(app, &single.title, &format_time(single.remind_at));
    }
    let title = format!("{} 条事项到点", due.len());
    notify::notify(app, &title, &aggregate_body(due))
}

/// 聚合正文：`A、B、C 等`（超出 3 条折叠）。
fn aggregate_body(due: &[Reminder]) -> String {
    let titles: Vec<&str> = due
        .iter()
        .take(AGGREGATE_TITLE_LIMIT)
        .map(|r| r.title.as_str())
        .collect();
    let joined = titles.join("、");
    if due.len() > AGGREGATE_TITLE_LIMIT {
        format!("{joined} 等")
    } else {
        joined
    }
}

/// 时刻格式化（本地时区 HH:MM）。
fn format_time(epoch_ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(epoch_ms)
        .map(|dt| {
            let local = dt.with_timezone(&chrono::Local);
            format!("{}", local.format("%H:%M"))
        })
        .unwrap_or_else(|| "到点".to_string())
}
