//! 数据根命令（V0.11.15，设计 §4.1）：取快照 / 切换（含撤销）/ 打开文件夹。
//!
//! 三条都只做「取 pool 与 identifier → 调 service → 返回」。判据（预检四类、空间、
//! 复制、核对、写指针）全在 `services::data_root`，本层**一次都不判路径**——抄两份判据
//! 改规则时必定漏一处。
//!
//! `identifier` 从 `app.config()` 读，不写常量：阶段二改 `tauri.conf.json` 之后指针
//! 文件的位置自动跟随。

use sqlx::SqlitePool;
use tauri::{AppHandle, Manager};

use crate::error::AppResult;
use crate::models::data_root::DataRootInfo;
use crate::services::data_root;
use crate::state::AppState;

fn pool_of(app: &AppHandle) -> SqlitePool {
    app.state::<AppState>().pool.clone()
}

/// `%APPDATA%\<identifier>` 是唯一能算出来的位置，而 `services` 不读 identifier
/// （那样它就没法用临时目录测）——所以在这一层读一次，往下传。
fn identifier(app: &AppHandle) -> String {
    app.config().identifier.clone()
}

/// 当前数据根 + 五项清单 + 受影响落点（设置页进页签时调一次）。
#[tauri::command]
pub async fn data_root_get(app: AppHandle) -> AppResult<DataRootInfo> {
    data_root::info(&pool_of(&app), &identifier(&app)).await
}

/// 切换（或撤销）数据根，返回刷新后的 info。
///
/// **`path = None` 是「撤销待生效的切换」，不是「没传参」**（设计 §8-4）：前端
/// `change(undefined)` 与 `change(null)` 走同一条路（`ipc.ts` 里 `?? null`）。
#[tauri::command]
pub async fn data_root_change(app: AppHandle, path: Option<String>) -> AppResult<DataRootInfo> {
    data_root::change(&pool_of(&app), &identifier(&app), path.as_deref()).await
}

/// 在资源管理器里打开当前数据根。目录不存在时回 `IO_ERROR`（**不创建**目录）。
#[tauri::command]
pub async fn data_root_open() -> AppResult<()> {
    data_root::open()
}
