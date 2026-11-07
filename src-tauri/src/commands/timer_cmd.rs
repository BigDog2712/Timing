//! 计时域命令（含崩溃恢复）。状态变更后 emit `timer:state-changed`。

use tauri::{AppHandle, State};

use crate::app::events;
use crate::error::AppResult;
use crate::models::enums::{ResolveAction, SwitchMode};
use crate::models::record::TimeRecord;
use crate::models::timer::{StopResult, TimerState};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn start_timer(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: Option<i64>,
) -> AppResult<TimeRecord> {
    let record = services::timer::start(&state.pool, item_id).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}

/// [V0.2.0] 开始倒计时会话（= 带 mode/target 的 `start_timer`）。非法 target → `INVALID_TARGET_SEC`。
#[tauri::command]
pub async fn start_countdown(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: Option<i64>,
    target_sec: i64,
) -> AppResult<TimeRecord> {
    let record = services::countdown::start(&state.pool, item_id, target_sec).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}

#[tauri::command]
pub async fn pause_timer(app: AppHandle, state: State<'_, AppState>) -> AppResult<TimeRecord> {
    let record = services::timer::pause(&state.pool).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}

#[tauri::command]
pub async fn resume_timer(app: AppHandle, state: State<'_, AppState>) -> AppResult<TimeRecord> {
    let record = services::timer::resume(&state.pool).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}

/// [V0.3.4] 返回 `StopResult`：`discarded = true` 表示这次会话短于「最短记录时长」，
/// 后端已软删，前端据此不展示撤销条（ADR-023）。
#[tauri::command]
pub async fn stop_timer(app: AppHandle, state: State<'_, AppState>) -> AppResult<StopResult> {
    let result = services::timer::stop(&state.pool).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(result)
}

#[tauri::command]
pub async fn discard_timer(app: AppHandle, state: State<'_, AppState>) -> AppResult<()> {
    services::timer::discard(&state.pool).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(())
}

#[tauri::command]
pub async fn undo_stop(
    app: AppHandle,
    state: State<'_, AppState>,
    record_id: i64,
) -> AppResult<TimeRecord> {
    let record = services::timer::undo(&state.pool, record_id).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}

#[tauri::command]
pub async fn get_timer_state(state: State<'_, AppState>) -> AppResult<TimerState> {
    services::timer::state(&state.pool).await
}

#[tauri::command]
pub async fn switch_item(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: i64,
    mode: SwitchMode,
) -> AppResult<TimerState> {
    let timer_state = services::timer::switch(&state.pool, item_id, mode).await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(timer_state)
}

#[tauri::command]
pub async fn resolve_open_record(
    app: AppHandle,
    state: State<'_, AppState>,
    action: ResolveAction,
    end_at: Option<i64>,
    /* [V0.4.2] 可选：把「退出期间」并入累计（恢复对话框的勾选项）。
    缺省 false = R-2 原口径，老前端不带这个字段也不会报错。 */
    include_gap: Option<bool>,
) -> AppResult<Option<TimeRecord>> {
    let record =
        services::timer::resolve_open(&state.pool, action, end_at, include_gap.unwrap_or(false))
            .await?;
    services::md_sync::dirty::mark("timer");
    events::emit_timer_state(&app, &state.pool).await;
    Ok(record)
}
