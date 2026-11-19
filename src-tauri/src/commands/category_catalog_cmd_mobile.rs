//! 手机桩：分类目录命令（[0.14]）。
//!
//! `services::insight` 整棵 `#[cfg(desktop)]`，安卓上没有活动库（patina.db）可读。
//! 与 `window_cmd_mobile` 同一手法：模块名与函数名一字不变，命令名不变，
//! 前端契约在两端一致。这里回**空目录** —— 前端候选只剩内置键 + 当前值兜底，
//! 「两窗分类选用」在手机上退化为内置分类可选，不报错。

use crate::error::AppResult;
use crate::models::category_catalog::CategoryCatalogDto;
use tauri::{AppHandle, Runtime};

#[tauri::command]
pub async fn list_category_catalog<R: Runtime>(
    _app: AppHandle<R>,
) -> AppResult<CategoryCatalogDto> {
    Ok(CategoryCatalogDto::empty())
}
