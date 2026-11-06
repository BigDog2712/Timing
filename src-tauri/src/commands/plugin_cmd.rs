//! 插件域命令（V0.3.2）：`plugin_list` / `plugin_open_dir`。
//!
//! 插件是**声明式**的：宿主只读插件目录下的启动头 `plugin.json`，不执行插件代码
//! （见 `docs/plugin-spec.md` §1）。所以这两个命令都在毫秒级完成——不建索引、
//! 不做缓存、不后台预热，「重新加载」就是再调一次 `plugin_list`。
//!
//! [V0.11.6] 目录来源从 `app.path().app_data_dir()` 换成 `platform::app_dir`
//! （ADR-050 §2）：便携 `<exe>\plugins` / 回退 `%APPDATA%\com.timing.app\plugins`。
//! **保留 `AppHandle` 参数不动**：它不是 JSON 入参，但删参数会改命令签名，
//! 属于一次「为了好看而碰契约面」的改动，不值得。

use tauri::AppHandle;

use crate::error::{AppError, AppResult};
use crate::models::plugin::PluginListResult;
use crate::platform::app_dir;
use crate::services;

/// 列出用户装的插件与合并去重后的快捷计时预设。
///
/// 返回的 `plugins` **只**反映扫描到的插件：V0.3.4 起宿主不再往用户目录里播种
/// 任何示例（ADR-023），所以全新安装时它就是一个空列表，由前端给出空态说明。
///
/// 每次调用都会顺手确保用户插件目录存在：用户把整个 `plugins` 文件夹删了，
/// 下次打开设置页就会重新建好空目录，而不是显示一个不存在的路径。
///
/// 注意传的是 `plugin_base()`（插件根的**父目录**）：`plugin_fs::user_plugin_dir`
/// 自己会 `join("plugins")`，口径见 `platform::app_dir::plugin_base` 的注释。
#[tauri::command]
pub async fn plugin_list(_app: AppHandle) -> AppResult<PluginListResult> {
    let root = app_dir::plugin_base();
    if let Err(err) = services::plugin::ensure_user_dir(&root) {
        crate::log_warn!("ensure plugin dir failed: {err}");
    }
    Ok(services::plugin::list(&root))
}

/// 在资源管理器里打开用户插件目录（不存在则先建好再开）。
#[tauri::command]
pub async fn plugin_open_dir(_app: AppHandle) -> AppResult<()> {
    let root = app_dir::plugin_base();
    services::plugin::open_user_dir(&root).map_err(AppError::io)
}
