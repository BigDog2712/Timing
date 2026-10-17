//! 窗口操作（Rust 侧）。K-1：窗口 `visible:false`，由前端首帧后调 `show_window`。
//! K-5：拦截 CloseRequested -> hide()，进程不退出。
//! AC-23：多显示器工作区钳制（越界回落主屏），比较口径统一为**物理像素**（K-6/K-15）。
//! ADR-009：多窗口（设置面板为单例；便利贴/事项窗在各自波次接入同一钳制与防白闪纪律）。

use tauri::{
    AppHandle, Manager, PhysicalPosition, PhysicalSize, WebviewUrl, WebviewWindowBuilder, Window,
    WindowEvent,
};

use crate::error::{AppError, AppResult};
use crate::infra::geometry::{clamp_to_workarea, Rect, WorkArea};
use crate::infra::window_spec;
use crate::models::note::{Note, NoteGeometry};

const MAIN_WINDOW: &str = "main";

/// 显示主窗口。
pub fn show_main(app: &AppHandle) -> AppResult<()> {
    main_window(app)?.show().map_err(AppError::io)
}

/// 隐藏主窗口。
pub fn hide_main(app: &AppHandle) -> AppResult<()> {
    let window = main_window(app)?;
    window.hide().map_err(AppError::io)
}

/// 切换显隐。
pub fn toggle(app: &AppHandle) -> AppResult<()> {
    let window = main_window(app)?;
    if window.is_visible().map_err(AppError::io)? {
        window.hide().map_err(AppError::io)
    } else {
        show_main(app)
    }
}

/// 置顶开关。
pub fn set_always_on_top(app: &AppHandle, enabled: bool) -> AppResult<()> {
    main_window(app)?
        .set_always_on_top(enabled)
        .map_err(AppError::io)
}

/// 关闭请求拦截：阻止退出，改为隐藏（K-5）。
pub fn on_window_event(window: &Window, event: &WindowEvent) {
    if let WindowEvent::CloseRequested { api, .. } = event {
        api.prevent_close();
        let _ = window.hide();
    }
}

/// 读取指定 label 窗口的**物理像素**矩形（位置 + 尺寸）。
pub fn window_rect(app: &AppHandle, label: &str) -> AppResult<Rect> {
    let window = window_by_label(app, label)?;
    let pos = window.outer_position().map_err(AppError::io)?;
    let size = window.outer_size().map_err(AppError::io)?;
    Ok(Rect::new(pos.x, pos.y, size.width, size.height))
}

/// 枚举所有可用显示器的工作区（物理像素），并标记主屏。
///
/// `primary` 由 `primary_monitor()` 与各显示器按 (position, size) 比对得出 ——
/// `Monitor` 无稳定 id/eq，故以几何特征识别（显示器位置+分辨率组合足以区分）。
pub fn available_work_areas(app: &AppHandle) -> AppResult<Vec<WorkArea>> {
    let primary = app.primary_monitor().map_err(AppError::io)?;
    let monitors = app.available_monitors().map_err(AppError::io)?;
    Ok(monitors
        .iter()
        .map(|m| {
            let wa = m.work_area();
            let is_primary = primary
                .as_ref()
                .is_some_and(|p| p.position() == m.position() && p.size() == m.size());
            WorkArea {
                primary: is_primary,
                rect: Rect::new(wa.position.x, wa.position.y, wa.size.width, wa.size.height),
            }
        })
        .collect())
}

/// 把指定窗口钳回可见区（越界回落主屏中心）；返回是否发生移动。
///
/// 读到的位置与工作区均为物理像素，直接比较，无需 DPI 换算（K-6/K-15）。
pub fn reclamp(app: &AppHandle, label: &str) -> AppResult<bool> {
    let rect = window_rect(app, label)?;
    let areas = available_work_areas(app)?;
    let fixed = clamp_to_workarea(rect, &areas);
    if fixed == rect {
        return Ok(false);
    }

    let window = window_by_label(app, label)?;
    window
        .set_position(PhysicalPosition::new(fixed.x, fixed.y))
        .map_err(AppError::io)?;
    // 窗口多为固定尺寸，尺寸变化仅在极端小工作区时出现，属尽力而为。
    if (fixed.width, fixed.height) != (rect.width, rect.height) {
        if let Err(err) = window.set_size(PhysicalSize::new(fixed.width, fixed.height)) {
            eprintln!("[tickbar] reclamp set_size failed: {err}");
        }
    }
    Ok(true)
}

/// 主窗口钳制（AC-23）。
pub fn reclamp_main(app: &AppHandle) -> AppResult<bool> {
    reclamp(app, MAIN_WINDOW)
}

/// 打开 / 聚焦设置面板（单例；ADR-009）。
///
/// 已存在 → `show + set_focus`，不重复创建；不存在 → 按 `window_spec::SETTINGS` 创建。
pub fn open_settings_window(app: &AppHandle) -> AppResult<()> {
    let spec = window_spec::spec_for(window_spec::SETTINGS.label)
        .ok_or_else(|| AppError::io("设置窗规格未登记"))?;
    open_panel_window(app, spec)
}

/// 打开 / 聚焦事项窗口（单例；label `todos`；ADR-009）。
pub fn open_todos_window(app: &AppHandle) -> AppResult<()> {
    let spec = window_spec::spec_for(window_spec::TODOS.label)
        .ok_or_else(|| AppError::io("事项窗规格未登记"))?;
    open_panel_window(app, spec)
}

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
        .always_on_top(spec.always_on_top)
        .visible(false)
        .additional_browser_args(WEBVIEW_ADDITIONAL_ARGS)
        .build()
        .map_err(AppError::io)?;
    reclamp(app, &label)?;
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

/// 单例面板窗的建/复用公共实现（设置窗 / 事项窗共享）。
///
/// 防白闪三件套（K-18）：`visible(false)` + `transparent(true)`（早显为不可见）+
/// 页面内联主题脚本 / 兜底背景（前端，index.html）。
///
/// **几何时序（K-6/K-15）**：`build()` 内先落 `center()`；随后 `window-state` 的
/// `on_window_ready` 同步恢复该 label 的**物理像素**位置/尺寸（若磁盘有存档且目标屏仍相交）；
/// 最后本函数调 `reclamp` 做兜底钳制。三步里的比较口径统一为**物理像素**，无需 DPI 换算。
/// WebView2 附加参数（传给 wry，会**替换** wry 默认串，故须显式带上默认项）：
/// - 保留 wry 默认 `--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection`（禁 mini-menu / PDF / SmartScreen）。
/// - `RendererCodeIntegrity`：中文环境常见因输入法/安全软件向渲染进程注入 DLL，触发 Chromium 的
///   渲染器代码完整性校验而判死渲染器 → 崩溃；禁用该项可避免。
/// - `--disable-gpu`：透明窗口在 GPU 合成下也可能致渲染进程崩溃，一并规避（软渲染）。
const WEBVIEW_ADDITIONAL_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,RendererCodeIntegrity --disable-gpu";

fn open_panel_window(app: &AppHandle, spec: &window_spec::WindowSpec) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(spec.label) {
        existing.show().map_err(AppError::io)?;
        existing.set_focus().map_err(AppError::io)?;
        return Ok(());
    }

    WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.url.into()))
        .title(spec.title)
        .inner_size(spec.width, spec.height)
        .min_inner_size(spec.min_width, spec.min_height)
        .max_inner_size(spec.max_width, spec.max_height)
        .resizable(spec.resizable)
        .decorations(spec.decorations)
        .transparent(spec.transparent)
        .shadow(false)
        .skip_taskbar(spec.skip_taskbar)
        .always_on_top(spec.always_on_top)
        .center()
        .visible(false)
        .additional_browser_args(WEBVIEW_ADDITIONAL_ARGS)
        .build()
        .map_err(AppError::io)?;

    reclamp(app, spec.label)?;
    Ok(())
}

fn main_window(app: &AppHandle) -> AppResult<tauri::WebviewWindow> {
    window_by_label(app, MAIN_WINDOW)
}

fn window_by_label(app: &AppHandle, label: &str) -> AppResult<tauri::WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::io(format!("窗口 {label} 不存在")))
}
