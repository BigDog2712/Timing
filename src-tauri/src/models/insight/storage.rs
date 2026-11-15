use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePathSnapshot {
    pub install_dir: String,
    /// Timing 真正的数据根（`%APPDATA%\com.timing.app`）：计时库 `timing.db`、
    /// `md/` / `logs/` / `plugins/` / `backups/` 与 `patina/`（活动库那套）都在它下面。
    ///
    /// 与 `data_root` 是**包含关系**，不是一个东西：`data_root` 只描述活动库那一层
    /// （`<timing_data_root>/patina/data`，`patina.db` + `backups` + `remote-backup-temp`）。
    /// 设置页「数据目录」那一行要给用户看的是**这一个**——它才是「我的数据都在哪」。
    pub timing_data_root: String,
    /// 活动库那一层（见 `timing_data_root` 的说明）；SQLite 落点设置改的就是它。
    pub data_root: String,
    pub database_path: String,
    pub backup_dir: String,
    pub remote_backup_temp_dir: String,
    pub webview_root: String,
    pub is_custom_data_root: bool,
    pub is_custom_webview_root: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSizeSnapshot {
    pub install_dir_size_bytes: u64,
    /// `data_root` 里 sqlite 家族三个文件的合计（库文件本身多大）。
    pub data_size_bytes: u64,
    /// `timing_data_root` 的**递归**体积：计时库 + Markdown + 活动库 + 日志 + 插件 + 备份。
    /// 不能只算 sqlite 三个文件——那会让「数据目录 12 MB」与资源管理器里看到的 400 MB 对不上。
    pub timing_data_size_bytes: u64,
    pub backup_dir_size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCacheEntrySnapshot {
    pub label: String,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCacheSnapshot {
    pub webview_root: String,
    pub ebwebview_path: String,
    pub total_size_bytes: u64,
    pub reclaimable_size_bytes: u64,
    pub last_trim_at_ms: Option<u64>,
    pub entries: Vec<WebviewCacheEntrySnapshot>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMaintenanceSnapshot {
    pub last_error: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageSnapshot {
    pub paths: StoragePathSnapshot,
    pub sizes: StorageSizeSnapshot,
    pub webview_cache: WebviewCacheSnapshot,
    pub maintenance: StorageMaintenanceSnapshot,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationPreview {
    pub current_data_root: String,
    pub target_data_root: String,
    pub current_webview_root: String,
    pub target_webview_root: String,
    pub database_size_bytes: u64,
    pub backup_dir_size_bytes: u64,
    pub webview_cache_reclaimable_bytes: u64,
    pub requires_restart: bool,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StorageMigrationRequest {
    pub target_data_root: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WebviewCacheMigrationRequest {
    pub target_webview_root: String,
}
