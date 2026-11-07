//! 待办域命令（`todoCreate` / `todoUpdate` / `todoDelete` / `todoList` / `todoToggle`）。
//!
//! 仅做「反序列化 -> 调 service -> 序列化」，无业务、无 SQL。

use tauri::State;

use crate::error::AppResult;
use crate::models::record::TimeRecord;
use crate::models::todo::{Todo, TodoListParams, TodoPatch};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn todo_create(
    state: State<'_, AppState>,
    title: String,
    item_id: Option<i64>,
    planned_at: Option<i64>,
    remind_at: Option<i64>,
) -> AppResult<Todo> {
    let todo = services::todo::create(&state.pool, &title, item_id, planned_at, remind_at).await?;
    services::md_sync::dirty::mark("todo");
    Ok(todo)
}

#[tauri::command]
pub async fn todo_update(state: State<'_, AppState>, id: i64, patch: TodoPatch) -> AppResult<Todo> {
    let todo = services::todo::update(&state.pool, id, patch).await?;
    services::md_sync::dirty::mark("todo");
    Ok(todo)
}

#[tauri::command]
pub async fn todo_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    services::todo::delete(&state.pool, id).await?;
    services::md_sync::dirty::mark("todo");
    Ok(())
}

#[tauri::command]
pub async fn todo_list(
    state: State<'_, AppState>,
    include_done: Option<bool>,
    from: Option<i64>,
    to: Option<i64>,
) -> AppResult<Vec<Todo>> {
    let params = TodoListParams {
        include_done: include_done.unwrap_or(false),
        from,
        to,
    };
    services::todo::list(&state.pool, params).await
}

#[tauri::command]
pub async fn todo_toggle(state: State<'_, AppState>, id: i64, done: bool) -> AppResult<Todo> {
    let todo = services::todo::toggle(&state.pool, id, done).await?;
    services::md_sync::dirty::mark("todo");
    Ok(todo)
}

/// 待办 → 计时（V0.3.12 / ADR-030）：开始计时并立刻把这条待办移出待办区。
#[tauri::command]
pub async fn todo_start(state: State<'_, AppState>, id: i64) -> AppResult<TimeRecord> {
    let record = services::todo_start::start(&state.pool, id).await?;
    services::md_sync::dirty::mark("todo");
    Ok(record)
}
