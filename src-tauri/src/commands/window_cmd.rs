//! 多窗口域命令（V0.2.0 / ADR-009）。含设置面板、事项窗口与便利贴窗口。
//!
//! 仅做「反序列化 -> 调 service/infra -> 返回」，无业务、无 SQL。

use tauri::{AppHandle, State};

use crate::app::events;
use crate::error::AppResult;
use crate::infra::window;
use crate::services;
use crate::state::AppState;

/// 打开 / 聚焦设置面板（单例；已存在则前置聚焦，不重复创建）。
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> AppResult<()> {
    window::open_settings_window(&app)
}

/// 打开 / 聚焦事项窗口（单例；label `todos`）。
#[tauri::command]
pub async fn open_todos_window(app: AppHandle) -> AppResult<()> {
    window::open_todos_window(&app)
}

/// 打开 / 聚焦只读计时器窗口（单例；label `timer`）。
#[tauri::command]
pub async fn open_timer_window(app: AppHandle) -> AppResult<()> {
    window::open_timer_window(&app)
}

/// 打开 / 聚焦便利贴窗口（动态 label `note-{id}`；超上限 → `WINDOW_LIMIT_EXCEEDED`）。
#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let note = services::note::open_guard(&state.pool, note_id).await?;
    window::open_note_window(&app, &note)?;
    events::emit_note_window(&app, true, note_id);
    Ok(())
}

/// 收纳便利贴窗口：落盘几何 + 置 `is_open=0` + 销毁窗口 + emit `note-window-closed`。
#[tauri::command]
pub async fn close_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let geometry = window::note_geometry(&app, note_id);
    services::note::close(&state.pool, note_id, geometry).await?;
    window::close_note_window(&app, note_id)?;
    events::emit_note_window(&app, false, note_id);
    Ok(())
}

/* ---- [V0.12.0 Patina 融合] 时间统计窗口 -------------------------------------

这条命令是**宿主自己的**命令。为什么不直接让前端 invoke Patina 的
`cmd_show_main_window`：那条命令写在 `permissions/window-commands.toml` 里，
ACL 只授权给 `windows: ["patina"]`，从宿主窗口调用会被 Tauri 拒掉
（`not allowed on window "main" … allowed on: [windows: "patina"]`）。
宿主自己的命令没有 permission 声明，天然对所有窗口开放，也不必把 Timing 的
前端绑到 Patina 的命令名上（宿主继续走 `IpcApi` 的 typed 契约）。

窗的生命周期仍归 Patina：它自己管「最后可见 / 重建 / 就绪握手」，这里只递一个
show 请求。返回 false = 窗正在重建或还没就绪（点第二次就好），不当错误。 */
#[cfg(desktop)]
#[tauri::command]
pub async fn open_patina_window(app: AppHandle) -> AppResult<()> {
    if !crate::app::insight::tray::show_main_window(
        &app,
        crate::app::insight::main_window::MainWindowShowReason::TrayMenu,
    ) {
        crate::log_warn!("patina main window is not ready yet; the next request will retry");
    }
    Ok(())
}
