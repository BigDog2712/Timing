//! 提醒域命令（`reminderSet` / `reminderClear` / `reminderPending`）。
//!
//! 仅做「反序列化 -> 调 service -> 序列化」，无业务、无 SQL。

use tauri::State;

use crate::error::AppResult;
use crate::models::reminder::{Reminder, ReminderTarget};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn reminder_set(
    state: State<'_, AppState>,
    target: ReminderTarget,
    target_id: i64,
    remind_at: i64,
) -> AppResult<Reminder> {
    services::reminder::set(&state.pool, target, target_id, remind_at).await
}

#[tauri::command]
pub async fn reminder_clear(
    state: State<'_, AppState>,
    target: ReminderTarget,
    target_id: i64,
) -> AppResult<()> {
    services::reminder::clear(&state.pool, target, target_id).await
}

#[tauri::command]
pub async fn reminder_pending(state: State<'_, AppState>) -> AppResult<Vec<Reminder>> {
    services::reminder::pending(&state.pool).await
}
