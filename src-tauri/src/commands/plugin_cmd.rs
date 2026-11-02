//! 插件域命令（V0.3.2）：`plugin_list` / `plugin_open_dir`。
//!
//! 插件是**声明式**的：宿主只读插件目录下的启动头 `plugin.json`，不执行插件代码
//! （见 `docs/plugin-spec.md` §1）。所以这两个命令都在毫秒级完成——不建索引、
//! 不做缓存、不后台预热，「重新加载」就是再调一次 `plugin_list`。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::models::plugin::PluginListResult;
use crate::services;

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
