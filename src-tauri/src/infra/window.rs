//! 窗口操作（Rust 侧）。K-1：窗口 `visible:false`，由前端首帧后调 `show_window`。
//! K-5：拦截 CloseRequested -> hide()，进程不退出。
//! AC-23：多显示器工作区钳制（越界回落主屏），比较口径统一为**物理像素**（K-6/K-15）。
//! ADR-009：多窗口（设置面板为单例；便利贴/事项窗在各自波次接入同一钳制与防白闪纪律）。

use tauri::{
    AppHandle, LogicalPosition, Manager, PhysicalPosition, PhysicalSize, WebviewUrl,
    WebviewWindowBuilder, Window, WindowEvent,
};

use crate::error::{AppError, AppResult};
use crate::infra::geometry::{clamp_to_workarea, Rect, WorkArea};
use crate::infra::window_spec;

const MAIN_WINDOW: &str = "main";

/// 悬浮面板（事项窗）与主条之间的间隙（DIP）。主条已收缩到内容包围盒，留 6 像素不贴脸。
const PANEL_GAP_DIP: f64 = 6.0;

/// 面板窗的落位策略。
#[derive(Clone, Copy, PartialEq)]
enum PanelPlacement {
    /// 屏幕居中（设置窗、只读计时窗）
    Center,
    /// 主条正下方、**右边缘面板**对齐：窗口左侧留 `f64` 宽的透明区（事项窗的便利贴预览）。
    /// 事项窗是当前唯一「贴主条」的面板；设置窗 / 计时窗都居中。
    BelowMainInset(f64),
}

impl PanelPlacement {
    fn left_inset(self) -> f64 {
        match self {
            PanelPlacement::BelowMainInset(inset) => inset,
            _ => 0.0,
        }
    }
}

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

/// 主窗几何查询（工作区上界 / 主条矩形）拆到 `window_rect`（单文件 ≤300 行，ADR-017）；
/// 这里 re-export 保持 `window::main_work_area_dip` 等调用点不变。
pub use crate::infra::window_rect::{main_window_rect_dip, main_work_area_dip};

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
            crate::log_warn!("reclamp set_size failed: {err}");
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
    open_panel_window(app, spec, PanelPlacement::Center)
}

/// 打开 / 聚焦事项窗口（单例；label `todos`；ADR-009）。
///
/// 首次创建时贴到主条正下方（`PanelPlacement::BelowMainInset`），之后只 show + focus，
/// 不再挪位置——面板一关一开不会「自己跳回屏幕中间」。
pub fn open_todos_window(app: &AppHandle) -> AppResult<()> {
    let spec = window_spec::spec_for(window_spec::TODOS.label)
        .ok_or_else(|| AppError::io("事项窗规格未登记"))?;
    open_panel_window(
        app,
        spec,
        PanelPlacement::BelowMainInset(window_spec::TODOS_PREVIEW_INSET),
    )
}

/// 打开 / 聚焦只读计时器窗口（单例）。
pub fn open_timer_window(app: &AppHandle) -> AppResult<()> {
    let spec = window_spec::spec_for(window_spec::TIMER.label)
        .ok_or_else(|| AppError::io("计时器窗规格未登记"))?;
    open_panel_window(app, spec, PanelPlacement::Center)
}

/* 便利贴窗口的 4 个操作拆到 `window_note`（单文件 ≤300 行，ADR-017）；
这里 re-export 保持 `window::open_note_window` 等调用点不变。 */
pub use crate::infra::window_note::{
    apply_note_pin, close_note_window, note_geometry, open_note_window,
};

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
pub(super) const WEBVIEW_ADDITIONAL_ARGS: &str =
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,RendererCodeIntegrity --disable-gpu";

fn open_panel_window(
    app: &AppHandle,
    spec: &window_spec::WindowSpec,
    placement: PanelPlacement,
) -> AppResult<()> {
    if let Some(existing) = app.get_webview_window(spec.label) {
        /* [V0.3.1] 贴主条的落位每开每算：窗口是单例，`show()` 只还原显隐、不动位置，
        小条被拖走后它仍停在上次落点，观感就是「没在悬浮条附近打开」。
        这里在显示前按小条当前位置重算一次（用户在小条下方拖动过的窗口会被拉回默认位，
        这是「默认落位」的代价；要保留手动位置就得关掉这条）。 */
        if matches!(placement, PanelPlacement::BelowMainInset(_)) {
            if let Some((x, y)) = below_main_position(app, placement.left_inset()) {
                if let Err(err) = existing.set_position(LogicalPosition::new(x, y)) {
                    crate::log_warn!("reposition {} failed: {err}", spec.label);
                }
            }
        }
        existing.show().map_err(AppError::io)?;
        existing.set_focus().map_err(AppError::io)?;
        return Ok(());
    }

    let mut builder = WebviewWindowBuilder::new(app, spec.label, WebviewUrl::App(spec.url.into()))
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
        .visible(false);

    /* 落位：主条下方需要先读主窗矩形（物理像素 ÷ scale = DIP），读不到再退回居中。 */
    builder = match placement {
        PanelPlacement::Center => builder.center(),
        PanelPlacement::BelowMainInset(_) => {
            match below_main_position(app, placement.left_inset()) {
                Some((x, y)) => builder.position(x, y),
                None => builder.center(),
            }
        }
    };

    builder
        .additional_browser_args(WEBVIEW_ADDITIONAL_ARGS)
        .build()
        .map_err(AppError::io)?;

    reclamp(app, spec.label)?;
    Ok(())
}

/// 主条正下方落位（DIP）。`left_inset` > 0 时窗口整体左移该宽度，
/// 使**窗口右缘**贴着主条左边缘——面板占右侧、左侧留透明预览区（事项窗用）。
/// 主窗不可用 / scale 非法时返回 None，调用方退回居中。
fn below_main_position(app: &AppHandle, left_inset: f64) -> Option<(f64, f64)> {
    let main = app.get_webview_window(MAIN_WINDOW)?;
    let pos = main.outer_position().ok()?;
    let size = main.outer_size().ok()?;
    let scale = main.scale_factor().ok()?;
    if scale.is_nan() || scale <= 0.0 {
        return None;
    }
    let x = pos.x as f64 / scale - left_inset;
    let y = (pos.y as f64 + size.height as f64) / scale + PANEL_GAP_DIP;
    Some((x, y))
}

fn main_window(app: &AppHandle) -> AppResult<tauri::WebviewWindow> {
    window_by_label(app, MAIN_WINDOW)
}

fn window_by_label(app: &AppHandle, label: &str) -> AppResult<tauri::WebviewWindow> {
    app.get_webview_window(label)
        .ok_or_else(|| AppError::io(format!("窗口 {label} 不存在")))
}
