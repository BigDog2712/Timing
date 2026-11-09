use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StoragePathSnapshot {
    pub install_dir: String,
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
    pub data_size_bytes: u64,
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
