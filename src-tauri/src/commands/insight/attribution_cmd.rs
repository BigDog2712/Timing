//! 应用分类绑定命令（活动库，仅桌面）。
//!
//! 三条命令都走活动库的 pool，所以整块在 `ipc_commands.rs` 的 Patina 段里注册。
//!
//! ## 为什么在命令层取 `now_ms` 而不是在 service
//!
//! `now_ms` 是「这一次写入的发生时刻」，它要参与 `updated_at_ms` 的单调盖戳
//! （`MAX(now, OLD+1)`）。在 service 里再取一次会让「同一个用户动作」在两张表上
//! 拿到两个不同的时间戳，跨设备 LWW 时表现为「后写的反而更旧」。

use tauri::{AppHandle, Runtime};

use crate::services::insight::data::app_category_service::{self, AppCategoryDto};
use crate::services::insight::data::sqlite_pool::wait_for_sqlite_pool;

/// 列绑定：`app_key` 为空 = 全部应用（设置页总览）。
#[tauri::command]
pub async fn cmd_list_app_categories<R: Runtime>(
    app: AppHandle<R>,
    app_key: Option<String>,
) -> Result<Vec<AppCategoryDto>, String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    app_category_service::list(&pool, app_key.as_deref()).await
}

/// 设一条绑定（幂等）。`priority` 越小越靠前，最小者即「分类首位」。
#[tauri::command]
pub async fn cmd_set_app_category<R: Runtime>(
    app: AppHandle<R>,
    app_key: String,
    category_key: String,
    priority: i64,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    app_category_service::set(
        &pool,
        &app_key,
        &category_key,
        priority,
        crate::infra::insight::clock::unix_timestamp_millis_i64(),
    )
    .await
}

/// 删一条绑定。返回是否真的删掉了一行。
#[tauri::command]
pub async fn cmd_remove_app_category<R: Runtime>(
    app: AppHandle<R>,
    app_key: String,
    category_key: String,
) -> Result<bool, String> {
    let pool = wait_for_sqlite_pool(&app).await?;
    app_category_service::remove(&pool, &app_key, &category_key).await
}
