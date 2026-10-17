//! 便利贴窗口启动恢复（ADR-009 §5 / K-14）：按 `notes.is_open=1` 逐个重建窗口。
//!
//! 在 `setup` 阶段（主线程）同步执行：先 blocking 读取打开态便利贴，再逐个建窗
//! （建窗须在主线程，故不用 `async_runtime::spawn`）。

use tauri::{AppHandle, Manager};

use crate::infra::window;
use crate::services;
use crate::state::AppState;

/// 恢复上次打开的便利贴窗口（失败仅记录日志，不阻塞启动）。
pub fn restore_open(app: &AppHandle) {
    let pool = app.state::<AppState>().pool.clone();
    let notes = match tauri::async_runtime::block_on(services::note::list_open(&pool)) {
        Ok(notes) => notes,
        Err(err) => {
            eprintln!("[tickbar] load open notes failed: {err}");
            return;
        }
    };
    for note in notes {
        if let Err(err) = window::open_note_window(app, &note) {
            eprintln!("[tickbar] restore note window {} failed: {err}", note.id);
        }
    }
}
