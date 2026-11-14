//! 事项 ↔ 应用绑定域命令。
//!
//! 四条命令覆盖设置页「事项详情 → 绑定应用」的全部交互：列出已绑定、绑定（幂等）、
//! 解绑、反查「这个应用参与了哪些事项」。
//!
//! `app_key` 由前端传**活动库归一后的键**（`sessions.app_key` 的同一个值）。
//! 归一只有那一个实现，这里不做二次归一 —— 见 `models::item_app` 的模块头。

use tauri::State;

use crate::error::AppResult;
use crate::models::item_app::{ItemApp, ItemAppBind};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_item_apps(state: State<'_, AppState>, item_id: i64) -> AppResult<Vec<ItemApp>> {
    services::item_app::list_for_item(&state.pool, item_id).await
}

#[tauri::command]
pub async fn list_items_for_app(
    state: State<'_, AppState>,
    app_key: String,
) -> AppResult<Vec<ItemApp>> {
    services::item_app::list_for_app(&state.pool, &app_key).await
}

#[tauri::command]
pub async fn bind_item_app(state: State<'_, AppState>, input: ItemAppBind) -> AppResult<ItemApp> {
    let bound = services::item_app::bind(&state.pool, input.item_id, &input.app_key, input.track).await?;
    /* 绑定的变动对 md 同步来说是「事实变了」：绑定会影响子记录归属，
       不打断同步的话 md 侧看到的分类会与界面不一致。 */
    services::md_sync::dirty::mark("item");
    Ok(bound)
}

#[tauri::command]
pub async fn unbind_item_app(
    state: State<'_, AppState>,
    item_id: i64,
    app_key: String,
) -> AppResult<bool> {
    let removed = services::item_app::unbind(&state.pool, item_id, &app_key).await?;
    services::md_sync::dirty::mark("item");
    Ok(removed)
}
