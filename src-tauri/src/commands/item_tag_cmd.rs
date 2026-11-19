//! 事项标签命令（`items.tags` 的读 / 覆盖写 / 改名 / 删除 / 定义行）。
//!
//! 读写分离成两条命令而不是塞进 `Item`：事项 DTO 有二十多处结构体字面量，加字段
//! 会把「标签」这件事扩散到所有构造点；标签本身是可独立刷新的稀疏数据，一次
//! `list_item_tags` 拿全量、前端按 id 合并即可。
//!
//! 改名 / 删除是**跨事项**的批量动作（标签是路径，改一个 `学习` 要改掉所有
//! `学习/**`），所以放在后端一个事务里做：前端逐条 `set_item_tags` 会有中间态，
//! 中途失败就留下一半旧一半新的标签树。

use tauri::{AppHandle, State};

use crate::error::AppResult;
use crate::models::item_tags::{ItemTags, TagMutation};
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

/// 全部标签定义（`settings` 的 `tag.def.*` 行）。没有事项引用的新标签靠它存在。
#[tauri::command]
pub async fn list_tag_catalog(state: State<'_, AppState>) -> AppResult<Vec<String>> {
    services::item_tag::definitions(&state.pool).await
}

#[tauri::command]
pub async fn create_tag_definition(
    state: State<'_, AppState>,
    path: String,
) -> AppResult<Vec<String>> {
    services::item_tag::create_definition(&state.pool, &path, crate::platform::clock::now_ms())
        .await
}

/// 改名（含子树）。`itemId: 0` 是「批量改动」的广播值：前端各窗收到后重拉全量。
#[tauri::command]
pub async fn rename_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    from: String,
    to: String,
) -> AppResult<TagMutation> {
    let result =
        services::item_tag::rename(&state.pool, &from, &to, crate::platform::clock::now_ms())
            .await?;
    crate::services::md_sync::dirty::mark("item");
    crate::app::events::emit_item_tags_changed(&app, 0);
    Ok(result)
}

/// 删除（含子树）：事项上的引用与定义行一起清掉。
#[tauri::command]
pub async fn delete_tag(
    app: AppHandle,
    state: State<'_, AppState>,
    path: String,
) -> AppResult<TagMutation> {
    let result =
        services::item_tag::delete(&state.pool, &path, crate::platform::clock::now_ms()).await?;
    crate::services::md_sync::dirty::mark("item");
    crate::app::events::emit_item_tags_changed(&app, 0);
    Ok(result)
}
