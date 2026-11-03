//! 事件发射（Rust -> 前端）。
//!
//! 位于 `app` 装配层：事件载荷需要读业务状态（`services`），而 infra 已不允许依赖
//! `services`（R5），所以「读状态再广播」这一步只能属于装配层。

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};

use crate::services;

/// 计时状态变化事件名（IPC-CONTRACT-v2 §6）。
pub const TIMER_STATE_CHANGED: &str = "timer:state-changed";

/// 主题 / 四色变更事件名（V0.2.0，IPC-CONTRACT §5.5；广播所有窗口，K-21）。
pub const THEME_CHANGED: &str = "theme-changed";

/* [V0.2.0 批 2] 新增事件（ARCHITECTURE-V0.2.0 §5.5） */
/// 倒计时到点事件名（前端据此播放铃声 + 瞬时提示，K-20/K-22）。
pub const COUNTDOWN_FINISHED: &str = "countdown-finished";
/// 提醒命中到点事件名（主窗弹轻提示 + 刷新铃铛态）。
pub const REMINDER_FIRED: &str = "reminder-fired";
/// 待办两级提醒事件名（V0.3.12 / ADR-030）：`stage=1` 轻提醒（T-15，问要不要改时间），
/// `stage=2` 自动开始询问（T-5，问当前结束后是否自动开始）。载荷 `models::nudge::TodoNudge`。
pub const TODO_NUDGE: &str = "todo-nudge";
/// 便利贴窗口创建 / 显示事件名。
pub const NOTE_WINDOW_OPENED: &str = "note-window-opened";
/// 便利贴窗口销毁事件名。
pub const NOTE_WINDOW_CLOSED: &str = "note-window-closed";
/// 托盘「便利贴…」要求前端新建并打开便利贴（应用内事件，非 IPC 命令）。
pub const APP_OPEN_NEW_NOTE: &str = "app:open-new-note";
/// 托盘图标**双击**后广播：主窗据此把小条高亮闪一下（定位用；V0.3.1）。
/// 颜色取设置里的「高亮颜色」（`timing.highlight_color`），主窗收到事件时现读。
pub const TRAY_HIGHLIGHT: &str = "tray:highlight";
/// 托盘「新建事项…」要求前端打开内联命名（应用内事件，非 IPC 命令）。
pub const APP_OPEN_NEW_ITEM: &str = "app:open-new-item";
/// [V0.4.0] Markdown 同步把文件改动写回 SQL 后广播（载荷 `MdSyncReport`）。
/// 前端据此刷新事项 / 计时 / 明细 / 便利贴，避免「文件改了但界面还是旧的」。
pub const MD_SYNC_CHANGED: &str = "md-sync:changed";

/// 读取最新 `TimerState` 并 emit 给前端（权威状态）。
///
/// 计时状态迁移同时重建托盘菜单控制组（ADR-013：仅状态迁移时重建，K-30）。
pub async fn emit_timer_state(app: &AppHandle, pool: &SqlitePool) {
    match services::timer::state(pool).await {
        Ok(state) => {
            sync_tray(app, pool, &state).await;
            if let Err(err) = app.emit(TIMER_STATE_CHANGED, &state) {
                crate::log_warn!("emit {TIMER_STATE_CHANGED} failed: {err}");
            }
        }
        Err(err) => crate::log_warn!("build timer state failed: {err}"),
    }
}

/// 托盘状态同步（桌面：重建原生菜单；移动端：无托盘，空实现）。
///
/// 抽成函数而不是在调用点 `#[cfg]`：`emit_timer_state` 是唯一的状态广播入口，
/// 平台差异必须留在它下面一层，否则以后多一个广播点就会漏一次门控。
/// 移动端整段跳过 —— 连 `tray_snapshot` 的查询都不做（没人消费那份快照）。
#[cfg(desktop)]
async fn sync_tray(app: &AppHandle, pool: &SqlitePool, state: &crate::models::timer::TimerState) {
    match services::timer::tray_snapshot(pool, state).await {
        Ok(snapshot) => crate::app::tray::sync_status(app, &snapshot),
        Err(err) => crate::log_warn!("build tray snapshot failed: {err}"),
    }
}

#[cfg(mobile)]
async fn sync_tray(
    _app: &AppHandle,
    _pool: &SqlitePool,
    _state: &crate::models::timer::TimerState,
) {
}

/// 读取最新主题 / 四色并广播 `theme-changed`（所有窗口自订阅，K-21）。
pub async fn emit_theme_changed(app: &AppHandle, pool: &SqlitePool) {
    match services::theme::changed(pool).await {
        Ok(payload) => {
            if let Err(err) = app.emit(THEME_CHANGED, payload) {
                crate::log_warn!("emit {THEME_CHANGED} failed: {err}");
            }
        }
        Err(err) => crate::log_warn!("build theme payload failed: {err}"),
    }
}

/// 广播 `countdown-finished`（倒计时到点；前端播铃声 + 瞬时提示）。
pub fn emit_countdown_finished(app: &AppHandle, payload: &crate::models::timer::CountdownFinished) {
    if let Err(err) = app.emit(COUNTDOWN_FINISHED, payload) {
        crate::log_warn!("emit {COUNTDOWN_FINISHED} failed: {err}");
    }
}

/// 广播 `reminder-fired`（提醒命中；payload 为单条 `Reminder`）。
pub fn emit_reminder_fired(app: &AppHandle, reminder: &crate::models::reminder::Reminder) {
    if let Err(err) = app.emit(REMINDER_FIRED, reminder) {
        crate::log_warn!("emit {REMINDER_FIRED} failed: {err}");
    }
}

/// 广播 `todo-nudge`（待办两级提醒；payload 为单条 `TodoNudge`）。
pub fn emit_todo_nudge(app: &AppHandle, nudge: &crate::models::nudge::TodoNudge) {
    if let Err(err) = app.emit(TODO_NUDGE, nudge) {
        crate::log_warn!("emit {TODO_NUDGE} failed: {err}");
    }
}

/// 广播 `md-sync:changed`（payload 为一次同步的 `MdSyncReport`）。
pub fn emit_md_sync_changed(app: &AppHandle, report: &crate::models::md_sync::MdSyncReport) {
    if let Err(err) = app.emit(MD_SYNC_CHANGED, report) {
        crate::log_warn!("emit {MD_SYNC_CHANGED} failed: {err}");
    }
}

/// 广播便利贴窗口开 / 关事件（payload `{ noteId }`）。
pub fn emit_note_window(app: &AppHandle, opened: bool, note_id: i64) {
    let (name, payload) = if opened {
        (NOTE_WINDOW_OPENED, serde_json::json!({ "noteId": note_id }))
    } else {
        (NOTE_WINDOW_CLOSED, serde_json::json!({ "noteId": note_id }))
    };
    if let Err(err) = app.emit(name, payload) {
        crate::log_warn!("emit {name} failed: {err}");
    }
}
