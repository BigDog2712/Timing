//! 事件发射（Rust -> 前端）。

use sqlx::SqlitePool;
use tauri::{AppHandle, Emitter};

use crate::infra::tray;
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
/// 便利贴窗口创建 / 显示事件名。
pub const NOTE_WINDOW_OPENED: &str = "note-window-opened";
/// 便利贴窗口销毁事件名。
pub const NOTE_WINDOW_CLOSED: &str = "note-window-closed";
/// 托盘「编辑固定任务…」要求前端打开「常用事项」菜单（应用内事件，非 IPC 命令）。
pub const APP_OPEN_COMMON_ITEMS: &str = "app:open-common-items";
/// 托盘「便利贴…」要求前端新建并打开便利贴（应用内事件，非 IPC 命令）。
pub const APP_OPEN_NEW_NOTE: &str = "app:open-new-note";

/// 读取最新 `TimerState` 并 emit 给前端（权威状态）。
///
/// 计时状态迁移同时重建托盘菜单控制组（ADR-013：仅状态迁移时重建，K-30），
/// 顺带按当前状态刷新主窗显隐菜单项。
pub async fn emit_timer_state(app: &AppHandle, pool: &SqlitePool) {
    match services::timer::state(pool).await {
        Ok(state) => {
            match services::timer::tray_snapshot(pool, &state).await {
                Ok(snapshot) => tray::sync_status(app, &snapshot),
                Err(err) => eprintln!("[tickbar] build tray snapshot failed: {err}"),
            }
            if let Err(err) = app.emit(TIMER_STATE_CHANGED, &state) {
                eprintln!("[tickbar] emit {TIMER_STATE_CHANGED} failed: {err}");
            }
        }
        Err(err) => eprintln!("[tickbar] build timer state failed: {err}"),
    }
}

/// 读取最新主题 / 四色并广播 `theme-changed`（所有窗口自订阅，K-21）。
pub async fn emit_theme_changed(app: &AppHandle, pool: &SqlitePool) {
    match services::theme::changed(pool).await {
        Ok(payload) => {
            if let Err(err) = app.emit(THEME_CHANGED, payload) {
                eprintln!("[tickbar] emit {THEME_CHANGED} failed: {err}");
            }
        }
        Err(err) => eprintln!("[tickbar] build theme payload failed: {err}"),
    }
}

/// 广播 `countdown-finished`（倒计时到点；前端播铃声 + 瞬时提示）。
pub fn emit_countdown_finished(app: &AppHandle, payload: &crate::models::timer::CountdownFinished) {
    if let Err(err) = app.emit(COUNTDOWN_FINISHED, payload) {
        eprintln!("[tickbar] emit {COUNTDOWN_FINISHED} failed: {err}");
    }
}

/// 广播 `reminder-fired`（提醒命中；payload 为单条 `Reminder`）。
pub fn emit_reminder_fired(app: &AppHandle, reminder: &crate::models::reminder::Reminder) {
    if let Err(err) = app.emit(REMINDER_FIRED, reminder) {
        eprintln!("[tickbar] emit {REMINDER_FIRED} failed: {err}");
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
        eprintln!("[tickbar] emit {name} failed: {err}");
    }
}
