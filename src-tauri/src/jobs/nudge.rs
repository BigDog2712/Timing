//! 待办提醒调度（ADR-030）：与 `reminder` 同样的 15s 查询式扫描，管两级提醒 + 到点自动开始。
//!
//! 每 tick：
//!   ① 先把「晚太久」的待办静默标成已处理（`expire`，不补弹、不自动开始）；
//!   ② T-15 轻提醒：先置位（stage=1）再 emit `todo-nudge`；
//!   ③ T-5 自动开始询问：同样先置位（stage=2）再 emit；
//!   ④ 到点自动开始：两级都过了且 `remind_at <= now` 的待办 ——
//!      **当前空闲**时直接开始（用户口径「若无事项，在既定时间自动开始计时」），
//!      或用户答应过「结束后自动开始」（`auto_start=1`）时在有会话的情况下等它结束再开始。
//!
//! 与 `jobs::reminder` 的分工：那边的 `reminder-fired` 只管**事项**到点提醒；
//! 待办的 `remind_at` 是「开始时间」，走本文件的两级链路，不再进通用提醒扫描。

use std::time::Duration;

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::app::events;
use crate::error::AppResult;
use crate::models::constants::REMINDER_SCAN_INTERVAL_SECS;
use crate::platform::clock::{self, now_ms};
use crate::services::todo_nudge::{self, STAGE_AUTOSTART, STAGE_LIGHT};
use crate::services::{self};
use crate::state::AppState;

/// 启动待办提醒调度后台任务（与 15s flusher / reminder 并行的独立 tokio 任务）。
pub fn spawn_nudge_watcher(app: AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(Duration::from_secs(REMINDER_SCAN_INTERVAL_SECS));
        ticker.tick().await; // 消耗首次立即触发
        loop {
            ticker.tick().await;
            let pool = app.state::<AppState>().pool.clone();
            if let Err(err) = scan_once(&app, &pool).await {
                crate::log_warn!("todo nudge scan failed: {err}");
            }
        }
    });
}

/// 单次扫描（查询式，非累计式 → 休眠唤醒后按 `remind_stage` 补齐到正确阶段）。
async fn scan_once(app: &AppHandle, pool: &SqlitePool) -> AppResult<()> {
    let now = now_ms();
    todo_nudge::expire(pool, now).await?;
    for stage in [STAGE_LIGHT, STAGE_AUTOSTART] {
        let due = todo_nudge::due(pool, stage, now).await?;
        if due.is_empty() {
            continue;
        }
        // 先置位再发事件：同一提醒只弹一次，崩溃重启不重弹（与 K-19 同口径）。
        todo_nudge::mark(pool, &due, now).await?;
        for nudge in &due {
            events::emit_todo_nudge(app, nudge);
        }
    }
    autostart(app, pool, now).await?;
    // ④ 过期清理（放在最后：先把该弹的、该开的处理完，再清掉过期项）
    purge_overdue(pool).await
}

/// 到点自动开始：空闲直接开始；有会话则只开始用户答应过的（`auto_start=1`）。
async fn autostart(app: &AppHandle, pool: &SqlitePool, now: i64) -> AppResult<()> {
    let idle = services::timer::state(pool)
        .await
        .map(|state| state.session.is_none())
        .unwrap_or(false);
    if !idle {
        return Ok(());
    }
    for nudge in todo_nudge::autostart_due(pool, now).await? {
        match services::todo_start::start(pool, nudge.todo_id).await {
            Ok(_) => events::emit_timer_state(app, pool).await,
            Err(err) => crate::log_warn!("auto start todo failed: {err}"),
        }
    }
    Ok(())
}

/// 过期清理（V0.3.15 / ADR-032）：截止时间早于「今天 00:00」且未完成的待办 → 软删除。
///
/// 与「待办区只显示今天」同一条边界：今天已经看不到的待办就不留着。每 15s 一次，
/// 平时命中 0 行（幂等、代价是一条走 `idx_todos_planned` 的 UPDATE）。
async fn purge_overdue(pool: &SqlitePool) -> AppResult<()> {
    let removed = services::todo::purge_overdue(pool, clock::start_of_today_ms()).await?;
    if removed > 0 {
        crate::log_info!("purged {removed} overdue todos");
    }
    Ok(())
}
