//! 事项标签命令（`items.tags` 的读 / 覆盖写）。
//!
//! 读写分离成两条命令而不是塞进 `Item`：事项 DTO 有二十多处结构体字面量，加字段
//! 会把「标签」这件事扩散到所有构造点；标签本身是可独立刷新的稀疏数据，一次
//! `list_item_tags` 拿全量、前端按 id 合并即可。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::item_tags::ItemTags;
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn list_item_tags(state: State<'_, AppState>) -> AppResult<Vec<ItemTags>> {
    services::item_tag::list(&state.pool).await
}

/// `tags` 是**全量覆盖**（不是增量）：归一结果原样返回，前端拿它回写草稿。
#[tauri::command]
pub async fn set_item_tags(
    app: AppHandle,
    state: State<'_, AppState>,
    item_id: i64,
    tags: Vec<String>,
) -> AppResult<Vec<String>> {
    let stored = services::item_tag::set(
        &state.pool,
        item_id,
        &tags,
        crate::platform::clock::now_ms(),
    )
    .await?;
    crate::services::md_sync::dirty::mark("item");
    crate::app::events::emit_item_tags_changed(&app, item_id);
    Ok(stored)
}
