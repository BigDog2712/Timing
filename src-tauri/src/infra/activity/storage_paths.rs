use crate::infra::activity::{app_paths, storage_control};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Runtime};

/// 活动库的**唯一真源**。
///
/// ⚠️ 这是**已落盘坐标**：它同时是用户磁盘上的文件名、`_sqlx_migrations` 之外一切
/// 搬迁/备份/核对的基准。改名必须与一次数据迁移同时做（T05），单独改这里等于让
/// 同一进程去开两个库文件。
pub const SQLITE_DB_FILE_NAME: &str = "patina.db";

/// 活动数据在数据根下的子目录名（`<数据根>/patina/data`）。
pub const DATA_SUBDIR: &str = "data";

/// 活动库的三个伴生文件：`-wal` / `-shm` / `-journal`。
///
/// **由 `SQLITE_DB_FILE_NAME` 派生，不许再写字面量。** 库名与伴生名一旦分叉，
/// 数据根搬迁时会把 `-wal` 当成普通文件拷过去（得到撕裂的一页），或反过来漏掉它。
pub fn sqlite_sidecar_names() -> [String; 3] {
    ["-wal", "-shm", "-journal"].map(|suffix| format!("{SQLITE_DB_FILE_NAME}{suffix}"))
}

const BACKUP_DIR_NAME: &str = "backups";
const REMOTE_BACKUP_TEMP_DIR_NAME: &str = "remote-backup-temp";

/// Timing 真正的数据根（`%APPDATA%\com.timing.app`）。
///
/// `StoragePaths` 描述的是它下面 `patina/data` 那一层（活动库 + 备份 + 远端临时件）。
/// 设置页「数据目录」那一行要给用户看的是**数据根**，不是这一层——用户问的是
/// 「我的数据都在哪」，答案里有 `timing.db`、`md/`、`logs/`、`plugins/`、`patina/`。
///
/// 顺带核实（V0.13.x，**只做判定，不做清理**）：`<数据根>/patina/patina.db` 与
/// `<数据根>/patina/data/patina.db` 在真机上同时存在，前者是 **0 字节的遗留空文件**
/// （早期融合布局把 `data_root` 当成 `patina/` 时留下的），活库在后者。
/// 不写自动删除：那是用户目录里的文件，判据不足时删库的代价远大于留一个空文件。
pub fn timing_data_root() -> PathBuf {
    crate::platform::app_dir::data_root()
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct StoragePaths {
    pub data_root: PathBuf,
    pub db_path: PathBuf,
    pub backup_dir: PathBuf,
    pub remote_backup_temp_dir: PathBuf,
    pub webview_root: PathBuf,
    pub is_custom_data_root: bool,
    pub is_custom_webview_root: bool,
}

impl StoragePaths {
    fn from_roots(
        data_root: PathBuf,
        webview_root: PathBuf,
        is_custom_data_root: bool,
        is_custom_webview_root: bool,
    ) -> Self {
        Self {
            db_path: data_root.join(SQLITE_DB_FILE_NAME),
            backup_dir: data_root.join(BACKUP_DIR_NAME),
            remote_backup_temp_dir: data_root.join(REMOTE_BACKUP_TEMP_DIR_NAME),
            data_root,
            webview_root,
            is_custom_data_root,
            is_custom_webview_root,
        }
    }
}

pub fn default_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    #[cfg(debug_assertions)]
    if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let root = std::env::var_os("PATINA_E2E_DATA_ROOT")
            .map(PathBuf::from)
            .ok_or_else(|| "PATINA_E2E_DATA_ROOT is required when PATINA_E2E=1".to_string())?;
        if !root.is_absolute() {
            return Err("PATINA_E2E_DATA_ROOT must be absolute".to_string());
        }
        return Ok(StoragePaths::from_roots(
            root.join("data"),
            root.join("webview"),
            false,
            false,
        ));
    }

    Ok(StoragePaths::from_roots(
        app_paths::product_roaming_data_dir(app)?,
        app_paths::product_webview_data_dir(app)?,
        false,
        false,
    ))
}

pub fn resolve_storage_paths<R: Runtime>(app: &AppHandle<R>) -> Result<StoragePaths, String> {
    resolve_roots(default_storage_paths(app)?, storage_control::read(app)?)
}

fn resolve_roots(
    defaults: StoragePaths,
    state: storage_control::StorageControl,
) -> Result<StoragePaths, String> {
    let custom_data = state.data_root.is_some();
    let custom_cache = state.webview_root.is_some();
    let paths = StoragePaths::from_roots(
        state.data_root.unwrap_or(defaults.data_root),
        state.webview_root.unwrap_or(defaults.webview_root),
        custom_data,
        custom_cache,
    );
    if custom_data {
        let metadata = std::fs::metadata(&paths.db_path).map_err(|e| {
            format!(
                "custom database `{}` is unavailable: {e}",
                paths.db_path.display()
            )
        })?;
        if !metadata.is_file() {
            return Err(format!(
                "custom database `{}` is not a file",
                paths.db_path.display()
            ));
        }
    }
    if custom_cache {
        std::fs::read_dir(&paths.webview_root).map_err(|e| {
            format!(
                "custom cache directory `{}` is unavailable: {e}",
                paths.webview_root.display()
            )
        })?;
    }
    Ok(paths)
}

pub fn derive_custom_webview_root(data_root: &Path) -> PathBuf {
    data_root.to_path_buf()
}

pub fn derive_custom_data_root(selected_root: &Path, product_folder: &str) -> PathBuf {
    if selected_root
        .file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| product_folder_name_eq(name, product_folder))
    {
        return selected_root.to_path_buf();
    }

    selected_root.join(product_folder)
}

pub fn db_path_for_data_root(data_root: &Path) -> PathBuf {
    data_root.join(SQLITE_DB_FILE_NAME)
}

pub fn backup_dir_for_data_root(data_root: &Path) -> PathBuf {
    data_root.join(BACKUP_DIR_NAME)
}

fn product_folder_name_eq(left: &str, right: &str) -> bool {
    #[cfg(windows)]
    {
        left.eq_ignore_ascii_case(right)
    }

    #[cfg(not(windows))]
    {
        left == right
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_custom_database_never_uses_existing_default_database() {
        let root =
            std::env::temp_dir().join(format!("patina-path-resolution-{}", std::process::id()));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join(SQLITE_DB_FILE_NAME), b"different database").unwrap();
        let defaults = StoragePaths::from_roots(root.clone(), root.clone(), false, false);
        let state = serde_json::from_value(serde_json::json!({
            "format":"patina.storage-control.v1", "profile":"dev", "dataRoot":root.join("missing"),
            "webviewRoot":null, "pending":null, "cleanupFiles":[],
            "maintenance":{"format":"patina.storage-maintenance-state.v1", "lastWebviewCacheTrimAtMs":null,"lastMaintenanceError":null}
        })).unwrap();
        assert!(resolve_roots(defaults, state)
            .unwrap_err()
            .contains("custom database"));
        assert_eq!(
            std::fs::read(root.join(SQLITE_DB_FILE_NAME)).unwrap(),
            b"different database"
        );
        std::fs::remove_file(root.join(SQLITE_DB_FILE_NAME)).unwrap();
        std::fs::remove_dir(root).unwrap();
    }

    #[test]
    fn custom_webview_root_uses_product_root_as_webview_parent() {
        assert_eq!(
            derive_custom_webview_root(Path::new("D:\\Patina Data")),
            PathBuf::from("D:\\Patina Data")
        );
    }

    #[test]
    fn custom_data_root_uses_product_folder_under_selected_root() {
        assert_eq!(
            derive_custom_data_root(Path::new("D:\\Storage"), "Patina"),
            PathBuf::from("D:\\Storage\\Patina")
        );
    }

    #[test]
    fn custom_data_root_does_not_duplicate_product_folder() {
        assert_eq!(
            derive_custom_data_root(Path::new("D:\\Storage\\Patina"), "Patina"),
            PathBuf::from("D:\\Storage\\Patina")
        );
    }

    #[test]
    fn custom_data_root_still_honours_the_shipped_product_folder_name() {
        /* 这条锁的是 `PRODUCT_FOLDER` 的**后果**，值锁在 `app_paths` 的
        `product_and_identifier_coordinates_are_frozen` 里。为什么两处都要：用户选根时
        选成 `D:\Patina`，`derive_custom_data_root` 必须认作「已经是产品目录」而不再拼一层。
        `PRODUCT_FOLDER` 一改名，同一句话就变成 `D:\Patina\NewName` —— 数据根静默搬家，
        用户在设置页看到的是「已切换」而历史全空。

        传真实常量而不是字面量：传字面量的话它只测到 `product_folder_name_eq` 的实现，
        `PRODUCT_FOLDER` 改了照样绿。 */
        assert_eq!(
            derive_custom_data_root(Path::new(r"D:\Patina"), app_paths::PRODUCT_FOLDER),
            PathBuf::from(r"D:\Patina")
        );
    }

    #[test]
    fn storage_paths_keep_remote_temp_under_data_root() {
        let paths = StoragePaths::from_roots(
            PathBuf::from("D:\\Patina Data"),
            PathBuf::from("D:\\Patina Data\\webview"),
            true,
            true,
        );

        assert_eq!(paths.db_path, PathBuf::from("D:\\Patina Data\\patina.db"));
        assert_eq!(paths.backup_dir, PathBuf::from("D:\\Patina Data\\backups"));
        assert_eq!(
            paths.remote_backup_temp_dir,
            PathBuf::from("D:\\Patina Data\\remote-backup-temp")
        );
    }
}
