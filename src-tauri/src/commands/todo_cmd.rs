//! 待办域命令（`todoCreate` / `todoUpdate` / `todoDelete` / `todoList` / `todoToggle`）。
//!
//! 仅做「反序列化 -> 调 service -> 序列化」，无业务、无 SQL。

use tauri::State;

use crate::error::AppResult;
use crate::models::todo::{Todo, TodoListParams, TodoPatch};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn todo_create(
    state: State<'_, AppState>,
    title: String,
    planned_at: Option<i64>,
    remind_at: Option<i64>,
) -> AppResult<Todo> {
    services::todo::create(&state.pool, &title, planned_at, remind_at).await
}

#[tauri::command]
pub async fn todo_update(state: State<'_, AppState>, id: i64, patch: TodoPatch) -> AppResult<Todo> {
    services::todo::update(&state.pool, id, patch).await
}

#[tauri::command]
pub async fn todo_delete(state: State<'_, AppState>, id: i64) -> AppResult<()> {
    services::todo::delete(&state.pool, id).await
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
    services::todo::toggle(&state.pool, id, done).await
}
