//! 全额数据包（单个 JSON）的 5 条命令：选落点 / 导出 / 选文件 / 预览 / 导入。
//!
//! ## 两个库各用哪条连接
//!
//! · **业务库**（`timing.db`，事项/计时/待办/便利贴/手机端用量）：宿主 `AppState.pool`。
//! · **活动库**（`patina/data/patina.db`，应用活动）：导出走 `patina_bridge` 的
//!   `mode=ro` 只读池（导出是只读动作，物理上不给写能力）；导入必须写，走 Patina
//!   自己的**可写**池 `wait_for_sqlite_pool`——那是它启动时就建好的那一条，不新开连接。
//!
//! ## 为什么预览不加 `require_main_window`
//!
//! 预览是只读的（只读文件、不碰库），挪到别的窗口也不会造成损害；而导入会写两个库，
//! 必须锁在主窗（设置页所在的那个 label）。

use crate::commands::insight::window_guard::require_main_window_string;
use crate::services::insight::data::bundle::{
    export_full_bundle, import_full_bundle, inspect_file, ExportSummary, ImportSummary,
    InspectSummary,
};
use crate::state::AppState;
use rfd::FileDialog;
use sqlx::SqlitePool;
use std::path::Path;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};

/// 选「导出到哪」。默认名带本地时间戳，重复导出不会互相覆盖。
#[tauri::command]
pub fn cmd_pick_full_bundle_save_file() -> Option<String> {
    FileDialog::new()
        .add_filter("Timing 全额数据包", &["json"])
        .set_file_name(default_bundle_file_name())
        .save_file()
        .map(|path| path.to_string_lossy().to_string())
}

/// 导出一个 JSON 包（只读两个库）。
#[tauri::command]
pub async fn cmd_export_full_bundle<R: Runtime>(
    app: AppHandle<R>,
    output_path: String,
) -> Result<ExportSummary, String> {
    let output = require_path(&output_path, "bundle output path")?;
    let business = business_pool(&app)?;
    let activity = crate::app::patina_bridge::activity_pool().await?;
    /* `device_id` 由这里读：`services::insight` 不依赖宿主的 `services::identity`，
       两边各读一次会出现「包里的 id 与本机 id 不是同一份」。 */
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    export_full_bundle(&business, activity, Path::new(&output), &device_id).await
}

/// 选一个 `.json` 数据包来预览 / 导入。
#[tauri::command]
pub fn cmd_pick_full_bundle_file() -> Option<String> {
    FileDialog::new()
        .add_filter("Timing 全额数据包", &["json"])
        .pick_file()
        .map(|path| path.to_string_lossy().to_string())
}

/// 导入前预览（**只读**：不建表、不写库、不动 `install_id.txt`）。
#[tauri::command]
pub async fn cmd_inspect_full_bundle(path: String) -> Result<InspectSummary, String> {
    let path = require_path(&path, "bundle path")?;
    inspect_file(Path::new(&path))
}

/// 导入（只 merge，不 replace；整包一个事务，失败全回滚）。
#[tauri::command]
pub async fn cmd_import_full_bundle<R: Runtime>(
    app: AppHandle<R>,
    window: WebviewWindow,
    path: String,
) -> Result<ImportSummary, String> {
    require_main_window_string(&window)?;
    let path = require_path(&path, "bundle path")?;
    let business = business_pool(&app)?;
    let activity =
        crate::services::insight::data::sqlite_pool::wait_for_sqlite_pool(&app).await?;
    import_full_bundle(&business, &activity, Path::new(&path)).await
}

/// `Timing-full-<YYYYMMDD-HHmm>.json`（**本地时间**：用户按自己表盘认文件）。
fn default_bundle_file_name() -> String {
    format!(
        "Timing-full-{}.json",
        chrono::Local::now().format("%Y%m%d-%H%M")
    )
}

fn require_path(raw: &str, label: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err(format!("{label} is empty"));
    }
    Ok(trimmed.to_string())
}

fn business_pool<R: Runtime>(app: &AppHandle<R>) -> Result<SqlitePool, String> {
    app.try_state::<AppState>()
        .map(|state| state.pool.clone())
        .ok_or_else(|| "timing sqlite state is not available".to_string())
}

#[cfg(test)]
mod tests {
    use super::{default_bundle_file_name, require_path};

    #[test]
    fn default_file_name_is_a_json_bundle_name() {
        let name = default_bundle_file_name();
        assert!(name.starts_with("Timing-full-"), "实际：{name}");
        assert!(name.ends_with(".json"), "实际：{name}");
        let stamp = &name["Timing-full-".len()..name.len() - ".json".len()];
        assert_eq!(stamp.len(), 13, "时间戳应是 YYYYMMDD-HHmm，实际：{stamp}");
        assert!(stamp.as_bytes()[8] == b'-', "实际：{stamp}");
        assert!(stamp
            .bytes()
            .enumerate()
            .all(|(index, byte)| index == 8 || byte.is_ascii_digit()));
    }

    #[test]
    fn blank_paths_are_rejected_before_touching_the_disk() {
        assert_eq!(require_path("   ", "bundle path").is_err(), true);
        assert_eq!(
            require_path("  D:\\tmp\\a.json  ", "bundle path").unwrap(),
            "D:\\tmp\\a.json".to_string()
        );
    }
}
