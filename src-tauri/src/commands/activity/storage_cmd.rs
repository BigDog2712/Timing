use crate::app::activity::state::AppExitState;
use crate::commands::activity::window_guard::require_main_window_string;
use crate::infra::activity::{storage_control, storage_paths, storage_usage, webview_cache};
use crate::models::activity::lifecycle::AppRestartState;
use crate::models::activity::storage::{
    StorageMaintenanceSnapshot, StorageMigrationPreview, StorageMigrationRequest,
    StoragePathSnapshot, StorageSnapshot, WebviewCacheMigrationRequest,
};
use crate::services::activity::data::{storage_migration, storage_restart};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

#[tauri::command]
pub fn cmd_pick_storage_directory() -> Option<String> {
    rfd::FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string())
}

/// 选一个 Markdown 文件（设置 → 同步 → 日记模板路径）。
///
/// 与 `cmd_pick_storage_directory` 同风格：**只返回路径**，不读文件、不校验内容 ——
/// 落库与校验都在设置保存那一步，这里多做的任何事都会变成「选文件就报错」。
/// 过滤器只放 md / markdown：模板是 Markdown，选到别的东西多半是选错了地方。
#[tauri::command]
pub fn cmd_pick_markdown_file() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cmd_get_storage_snapshot<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StorageSnapshot, String> {
    storage_snapshot(&app)
}

#[tauri::command]
pub async fn cmd_preview_storage_migration<R: Runtime>(
    app: AppHandle<R>,
    target_data_root: String,
) -> Result<StorageMigrationPreview, String> {
    storage_migration::preview_storage_migration(&app, StorageMigrationRequest { target_data_root })
        .await
}

#[tauri::command]
pub async fn cmd_preview_webview_cache_migration<R: Runtime>(
    app: AppHandle<R>,
    target_webview_root: String,
) -> Result<StorageMigrationPreview, String> {
    storage_migration::preview_webview_cache_migration(
        &app,
        WebviewCacheMigrationRequest {
            target_webview_root,
        },
    )
    .await
}

#[tauri::command]
pub async fn cmd_preview_restore_default_storage_migration<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StorageMigrationPreview, String> {
    storage_migration::preview_restore_default_storage_migration(&app).await
}

#[tauri::command]
pub async fn cmd_preview_restore_default_webview_cache_migration<R: Runtime>(
    app: AppHandle<R>,
) -> Result<StorageMigrationPreview, String> {
    storage_migration::preview_restore_default_webview_cache_migration(&app).await
}

#[tauri::command]
pub async fn cmd_restart_and_apply_storage_migration(
    app: AppHandle,
    window: WebviewWindow,
    target_data_root: String,
) -> Result<(), String> {
    require_main_window_string(&window)?;
    restart_after(app, |app| async move {
        storage_migration::schedule_storage_migration(
            app,
            StorageMigrationRequest { target_data_root },
        )
        .await
    })
    .await
}

#[tauri::command]
pub async fn cmd_restart_and_apply_webview_cache_migration(
    app: AppHandle,
    window: WebviewWindow,
    target_webview_root: String,
) -> Result<(), String> {
    require_main_window_string(&window)?;
    restart_after(app, |app| async move {
        storage_migration::schedule_webview_cache_migration(
            app,
            WebviewCacheMigrationRequest {
                target_webview_root,
            },
        )
        .await
    })
    .await
}

#[tauri::command]
pub async fn cmd_restart_and_apply_restore_default_storage_migration(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    require_main_window_string(&window)?;
    restart_after(app, |app| async move {
        storage_migration::schedule_restore_default_storage_migration(app).await
    })
    .await
}

#[tauri::command]
pub async fn cmd_restart_and_apply_restore_default_webview_cache_migration(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    require_main_window_string(&window)?;
    restart_after(app, |app| async move {
        storage_migration::schedule_restore_default_webview_cache_migration(app).await
    })
    .await
}

#[tauri::command]
pub async fn cmd_restart_and_clear_webview_cache(
    app: AppHandle,
    window: WebviewWindow,
) -> Result<(), String> {
    require_main_window_string(&window)?;
    restart_after(app, |app| async move {
        storage_restart::schedule_webview_cache_clear(app).await
    })
    .await
}

async fn restart_after<F, Fut, T>(app: AppHandle, operation: F) -> Result<(), String>
where
    F: FnOnce(AppHandle) -> Fut,
    Fut: std::future::Future<Output = Result<T, String>>,
{
    let restart_state = app.state::<AppRestartState>();
    if !restart_state.try_request() {
        return Err("Timing is already preparing to restart".to_string());
    }
    if let Err(error) = operation(app.clone()).await {
        restart_state.cancel_request();
        return Err(error);
    }
    app.state::<AppExitState>().request_exit();
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub fn cmd_open_storage_directory(path: String) -> Result<(), String> {
    open_directory(Path::new(&path))
}

fn storage_snapshot<R: Runtime>(app: &AppHandle<R>) -> Result<StorageSnapshot, String> {
    let paths = storage_paths::resolve_storage_paths(app)?;
    /* 设置页「数据目录」那一行要的是**数据根**（`%APPDATA%\com.timing.app`），
    不是 `paths.data_root`（那只是它下面的 `patina/data`）。两者都给出去，由前端选。 */
    let timing_data_root = storage_paths::timing_data_root();
    let install_dir = install_dir()?;
    let maintenance = storage_control::read_maintenance_state(app)
        .unwrap_or_else(|_| storage_control::StorageMaintenanceState::new());

    Ok(StorageSnapshot {
        paths: StoragePathSnapshot {
            install_dir: install_dir.to_string_lossy().to_string(),
            timing_data_root: timing_data_root.to_string_lossy().to_string(),
            data_root: paths.data_root.to_string_lossy().to_string(),
            database_path: paths.db_path.to_string_lossy().to_string(),
            backup_dir: paths.backup_dir.to_string_lossy().to_string(),
            remote_backup_temp_dir: paths.remote_backup_temp_dir.to_string_lossy().to_string(),
            webview_root: paths.webview_root.to_string_lossy().to_string(),
            is_custom_data_root: paths.is_custom_data_root,
            is_custom_webview_root: paths.is_custom_webview_root,
        },
        sizes: storage_usage::storage_size_snapshot(&install_dir, &paths, &timing_data_root),
        webview_cache: webview_cache::webview_cache_snapshot(app)?,
        maintenance: StorageMaintenanceSnapshot {
            last_error: maintenance.last_maintenance_error,
        },
    })
}

fn install_dir() -> Result<PathBuf, String> {
    let executable = std::env::current_exe()
        .map_err(|error| format!("failed to resolve current executable: {error}"))?;
    executable.parent().map(Path::to_path_buf).ok_or_else(|| {
        format!(
            "failed to resolve install directory for `{}`",
            executable.display()
        )
    })
}

fn open_directory(path: &Path) -> Result<(), String> {
    if !path.exists() {
        return Err(format!("directory `{}` does not exist", path.display()));
    }
    if !path.is_dir() {
        return Err(format!("path `{}` is not a directory", path.display()));
    }

    #[cfg(windows)]
    {
        std::process::Command::new("explorer")
            .arg(path)
            .spawn()
            .map(|_| ())
            .map_err(|error| format!("failed to open `{}`: {error}", path.display()))
    }

    #[cfg(not(windows))]
    {
        Err("opening local directories is only supported on Windows".to_string())
    }
}
