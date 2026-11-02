//! 便利贴域命令（`noteCreate` / `noteGet` / `noteList` / `noteUpdate` / `noteDelete`）。
//!
//! 仅做「反序列化 -> 调 service -> 序列化」，无业务、无 SQL。`note_delete` 额外关闭窗口并
//! emit `note-window-closed`（契约 §5.3）。

use tauri::{AppHandle, State};

use crate::app::events;
use crate::error::AppResult;
use crate::infra::window;
use crate::models::note::{Note, NoteCreateParams, NotePatch};
use crate::services;
use crate::state::AppState;

#[tauri::command]
pub async fn note_create(
    state: State<'_, AppState>,
    item_id: Option<i64>,
    content: String,
    pos_x: f64,
    pos_y: f64,
    width: f64,
    height: f64,
) -> AppResult<Note> {
    let params = NoteCreateParams {
        item_id,
        content,
        pos_x,
        pos_y,
        width,
        height,
    };
    services::note::create(&state.pool, params).await
}

#[tauri::command]
pub async fn note_get(state: State<'_, AppState>, id: i64) -> AppResult<Note> {
    services::note::get(&state.pool, id).await
}

#[tauri::command]
pub async fn note_list(state: State<'_, AppState>, item_id: Option<i64>) -> AppResult<Vec<Note>> {
    services::note::list(&state.pool, item_id).await
}

#[tauri::command]
pub async fn note_update(
    app: AppHandle,
    state: State<'_, AppState>,
    id: i64,
    patch: NotePatch,
) -> AppResult<Note> {
    let pin_changed = patch.is_pinned.is_some();
    let note = services::note::update(&state.pool, id, patch).await?;
    /* [V0.3.0] 置顶是**窗口属性**，光落库不会立刻改变层级；这里把最新值推给窗口。
    窗口未打开时 apply_note_pin 静默跳过，下次 open_note_window 会按列值建窗。

    **失败只记日志、不冒泡**：列值已经落库，此刻返回 Err 会让前端回滚乐观状态，
    结果是「库里 false、界面 true」的假象。窗口层级失败是瞬时的（窗口正在销毁 /
    被系统拒绝），下一次开窗会自愈。 */
    if pin_changed {
        if let Err(err) = window::apply_note_pin(&app, note.id, note.is_pinned) {
            crate::log_warn!("apply note pin failed (id={}): {err}", note.id);
        }
    }
    Ok(note)
}

/// 软删除 + 关闭该便利贴窗口（若开）+ emit `note-window-closed`。
#[tauri::command]
pub async fn note_delete(app: AppHandle, state: State<'_, AppState>, id: i64) -> AppResult<()> {
    if let Some(note) = services::note::delete(&state.pool, id).await? {
        let _ = window::close_note_window(&app, note.id);
        events::emit_note_window(&app, false, note.id);
    }
    Ok(())
}
