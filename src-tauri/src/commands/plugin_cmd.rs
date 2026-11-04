//! 插件域命令（V0.3.2 起）：`plugin_list` / `plugin_open_dir`；
//! [v3] 新增 `plugin_panel_open` / `plugin_panel_data` / `plugin_action_run`。
//!
//! 插件是**声明式**的：宿主只读插件目录下的启动头 `plugin.json`，不执行插件代码
//! （见 `docs/plugin-spec.md` §1）。所以这些命令都在毫秒级完成——不建索引、
//! 不做缓存、不后台预热，「重新加载」就是再调一次 `plugin_list`。
//!
//! [v3] 数据源与动作**都在命令层再挡一次白名单**：清单校验管的是「插件写错了」，
//! 这里管的是「调用方绕过清单直接调 IPC」。两边成本都是一行 `contains`。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::plugin::PluginListResult;
use crate::models::plugin_panel::{ActionParams, QueryParams, ACTIONS, SOURCES};
use crate::services;
use crate::services::plugin_panel::{PanelActionOutcome, PanelRow};
use crate::state::AppState;

/// 列出用户装的插件与合并去重后的快捷计时预设。
///
/// 返回的 `plugins` **只**反映扫描到的插件：V0.3.4 起宿主不再往用户目录里播种
/// 任何示例（ADR-023），所以全新安装时它就是一个空列表，由前端给出空态说明。
///
/// 每次调用都会顺手确保用户插件目录存在：用户把整个 `plugins` 文件夹删了，
/// 下次打开设置页就会重新建好空目录，而不是显示一个不存在的路径。
#[tauri::command]
pub async fn plugin_list(app: AppHandle) -> AppResult<PluginListResult> {
    let app_data_dir = app.path().app_data_dir().map_err(AppError::io)?;
    if let Err(err) = services::plugin::ensure_user_dir(&app_data_dir) {
        crate::log_warn!("ensure plugin dir failed: {err}");
    }
    Ok(services::plugin::list(&app_data_dir))
}

/// 在资源管理器里打开用户插件目录（不存在则先建好再开）。
#[tauri::command]
pub async fn plugin_open_dir(app: AppHandle) -> AppResult<()> {
    let app_data_dir = app.path().app_data_dir().map_err(AppError::io)?;
    services::plugin::open_user_dir(&app_data_dir).map_err(AppError::io)
}

/// [v3] 打开插件声明的面板窗口。
///
/// 面板 / 插件都是**调用时重新从磁盘读**的：插件可能刚被改过 `plugin.json`，
/// 或者已经被删掉。缓存一份清单在这里只会让「点开却打不开」变得难以解释。
#[tauri::command]
pub async fn plugin_panel_open(
    app: AppHandle,
    plugin_id: String,
    panel_id: String,
) -> AppResult<()> {
    #[cfg(mobile)]
    {
        let _ = (app, plugin_id, panel_id);
        return Err(crate::platform::host::desktop_only("plugin_panel_open"));
    }
    #[cfg(desktop)]
    {
        let app_data_dir = app.path().app_data_dir().map_err(AppError::io)?;
        let list = services::plugin::list(&app_data_dir);
        let plugin = list
            .plugins
            .iter()
            .find(|item| item.id == plugin_id && item.enabled && item.error.is_none())
            .ok_or_else(|| AppError::io("插件不存在，或已被停用 / 载入失败"))?;
        let panel = plugin
            .panels
            .iter()
            .find(|item| item.id == panel_id)
            .ok_or_else(|| AppError::io("该插件没有这个面板"))?;
        crate::infra::window_panel::open_panel_window(
            &app,
            &plugin_id,
            &panel_id,
            &panel.title,
            panel.width_or_default(),
            panel.height_or_default(),
        )
    }
}

/// [v3] 查询一个数据源。`source` 必须命中白名单——即使前端被改也能挡住。
#[tauri::command]
pub async fn plugin_panel_data(
    app: AppHandle,
    source: String,
    params: Option<QueryParams>,
) -> AppResult<Vec<PanelRow>> {
    if !SOURCES.contains(&source.as_str()) {
        return Err(AppError::io(format!("未知数据源：{source}")));
    }
    let pool = app.state::<AppState>().pool.clone();
    services::plugin_panel::query(&pool, &source, &params.unwrap_or_default()).await
}

/// [v3] 执行一个内置动作。动作有副作用（起计时 / 加待办），所以同样卡白名单。
#[tauri::command]
pub async fn plugin_action_run(
    app: AppHandle,
    action: String,
    params: Option<ActionParams>,
) -> AppResult<PanelActionOutcome> {
    if !ACTIONS.contains(&action.as_str()) {
        return Err(AppError::io(format!("未知动作：{action}")));
    }
    let pool = app.state::<AppState>().pool.clone();
    services::plugin_panel::run_action(&pool, &action, &params.unwrap_or_default()).await
}
