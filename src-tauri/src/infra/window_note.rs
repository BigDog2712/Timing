//! 便利贴窗口操作（动态 label `note-{id}`；ADR-009 / ADR-019）。
//!
//! 从 `infra::window` 拆出（单文件 ≤300 行，ADR-017）：便利贴是**每行一窗**的动态窗口，
//! 与「单例面板窗」的建窗逻辑完全不同（几何来自 DB 行、置顶来自列值），混在一个文件里
//! 只会让两套时序互相干扰阅读。单例窗仍留在 `window.rs`。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};
use crate::infra::window::{reclamp, WEBVIEW_ADDITIONAL_ARGS};
use crate::infra::window_spec;
use crate::models::note::{Note, NoteGeometry};

/// 打开 / 聚焦便利贴窗口（动态 label `note-{id}`；几何取自 DB 行，ADR-009）。
///
/// 已存在 → `show + set_focus`；不存在 → 按 `window_spec::NOTE` 建窗并落 DB 逻辑几何，
/// 再经 `reclamp` 按 `work_area` 兜底钳制（K-6/K-15）。防白闪守 `visible(false)`（K-18）。
pub fn open_note_window(app: &AppHandle, note: &Note) -> AppResult<()> {
    let label = window_spec::note_label(note.id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(AppError::io)?;
        existing.set_focus().map_err(AppError::io)?;
        return Ok(());
    }
    let spec = window_spec::spec_for(&label).ok_or_else(|| AppError::io("便利贴窗规格未登记"))?;
    let url = format!("{}&id={}", spec.url, note.id);
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(spec.title)
        .inner_size(note.width, note.height)
        .position(note.pos_x, note.pos_y)
        .min_inner_size(spec.min_width, spec.min_height)
        .max_inner_size(spec.max_width, spec.max_height)
        .resizable(spec.resizable)
        .decorations(spec.decorations)
        .transparent(spec.transparent)
        .shadow(false)
        .skip_taskbar(spec.skip_taskbar)
        /* [V0.3.0] 置顶取**该行**的持久化值，不再用 spec 的静态默认（ADR-019）。
        spec.always_on_top 仍为 true，只作「新建行列默认值 = 1」的说明性对齐。 */
        .always_on_top(note.is_pinned)
        .visible(false)
        .additional_browser_args(WEBVIEW_ADDITIONAL_ARGS)
        .build()
        .map_err(AppError::io)?;
    reclamp(app, &label)?;
    Ok(())
}

/// 运行时切换便利贴置顶（窗口未开则静默跳过；持久化由调用方负责）。
///
/// 与 `open_note_window` 的分工：那边决定「建窗那一刻的层级」，这边处理「建窗之后
/// 用户点 pin」。窗口不存在不是错误——用户可能在清单里改状态而窗口尚未打开。
pub fn apply_note_pin(app: &AppHandle, note_id: i64, pinned: bool) -> AppResult<()> {
    let label = window_spec::note_label(note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.set_always_on_top(pinned).map_err(AppError::io)?;
    }
    Ok(())
}

/// 销毁便利贴窗口（幂等；窗口不存在时静默成功）。
pub fn close_note_window(app: &AppHandle, note_id: i64) -> AppResult<()> {
    let label = window_spec::note_label(note_id);
    if let Some(win) = app.get_webview_window(&label) {
        win.destroy().map_err(AppError::io)?;
    }
    Ok(())
}

/// 读取便利贴窗口当前几何并换算为**逻辑像素**（物理像素 / `scaleFactor`，K-15）。
///
/// 窗口不存在 / 读取失败返回 `None`（调用方按「不落盘几何」处理）。
pub fn note_geometry(app: &AppHandle, note_id: i64) -> Option<NoteGeometry> {
    let label = window_spec::note_label(note_id);
    let win = app.get_webview_window(&label)?;
    let scale = win.scale_factor().ok()?;
    if scale <= 0.0 {
        return None;
    }
    let pos = win.outer_position().ok()?;
    let size = win.outer_size().ok()?;
    Some(NoteGeometry {
        pos_x: f64::from(pos.x) / scale,
        pos_y: f64::from(pos.y) / scale,
        width: f64::from(size.width) / scale,
        height: f64::from(size.height) / scale,
    })
}
