//! 插件面板窗口（动态 label `panel-{pluginId}-{panelId}`）。
//!
//! 与便利贴窗的区别：面板是**每个插件面板一窗**、几何由插件声明（不是 DB 行）、
//! 且**上任务栏**——它是用户主动打开的功能窗，不是跟着主条飘的浮层。
//!
//! 与设置窗的区别：面板可以有多个（每个插件最多 `MAX_PANELS` 个），所以不能用
//! `window_spec` 那张静态表（它的 label/url 是 `&'static str`）。

use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

use crate::error::{AppError, AppResult};
use crate::infra::window::{reclamp, WEBVIEW_ADDITIONAL_ARGS};

/// 面板窗口 label。同一面板重复打开 = 聚焦已有窗口，不会开出第二个。
pub fn panel_label(plugin_id: &str, panel_id: &str) -> String {
    format!("panel-{plugin_id}-{panel_id}")
}

/// 打开（或聚焦）插件面板窗口。
///
/// 尺寸由插件声明，但仍然限制在 `plugin_panel` 的上下限内——清单校验已经夹过一次，
/// 这里再夹一次是因为命令可以被前端直接调用，不该假设调用方守规矩。
pub fn open_panel_window(
    app: &AppHandle,
    plugin_id: &str,
    panel_id: &str,
    title: &str,
    width: f64,
    height: f64,
) -> AppResult<()> {
    let label = panel_label(plugin_id, panel_id);
    if let Some(existing) = app.get_webview_window(&label) {
        existing.show().map_err(AppError::io)?;
        existing.set_focus().map_err(AppError::io)?;
        return Ok(());
    }
    /* URL 参数是面板窗口的唯一身份来源：`App.tsx` 按 label 路由到
    `PluginPanelWindow`，那个组件再从查询参数里取 plugin / panel。 */
    let url = format!("index.html?w=panel&plugin={plugin_id}&panel={panel_id}");
    WebviewWindowBuilder::new(app, &label, WebviewUrl::App(url.into()))
        .title(title)
        .inner_size(width, height)
        .min_inner_size(280.0, 240.0)
        .max_inner_size(720.0, 900.0)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        /* 功能窗，该在任务栏留一个入口——与设置 / 事项 / 便利贴三类浮层相反。 */
        .skip_taskbar(false)
        .always_on_top(true)
        .visible(false)
        .additional_browser_args(WEBVIEW_ADDITIONAL_ARGS)
        .build()
        .map_err(AppError::io)?;
    reclamp(app, &label)?;
    Ok(())
}
