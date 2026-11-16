pub mod activity_read_model;
pub mod app_category_service;
pub mod app_settings_service;
/* [0.13.x] 事项归属：子记录分类解析（纯函数）与切片。 */
pub mod attribution;
pub mod backup;
/// [批 2] 全额数据包（单个 JSON）的导出 / 预览 / 导入。
pub mod bundle;
pub(crate) mod classification_deletion;
pub mod classification_service;
pub mod export;
/* [0.13.x] 事项块投影（focus_blocks）+ 子记录切片取数。 */
pub mod focus_blocks;
/* [0.13.x] 旧 KV 配置 → 新表的一次性回填（设计文档 §13）。 */
pub mod legacy_bindings;
pub mod icon_cache_service;
pub mod import;
pub mod mini_window_store;
pub mod remote_backup;
pub mod remote_backup_config;
pub mod remote_status_store;
pub mod repositories;
pub mod scheduled_backup;
pub mod scheduled_export;
mod staging_names;
pub mod schema;
pub mod schema_contracts;
pub mod schema_registry;
pub mod settings_payload_service;
pub mod sqlite_error;
pub mod sqlite_pool;
pub mod storage_migration;
mod storage_migration_cleanup;
mod storage_path_safety;
pub mod storage_restart;
pub mod sync;
pub mod tools_store;
pub mod tracking_pause_service;
pub mod tracking_runtime;
pub mod user_data_maintenance;
pub mod web_activity_analysis;
pub mod web_activity_store;

#[cfg(test)]
mod sqlite_pool_upgrade_tests;
pub mod tool_notification_store;
#[cfg(test)]
mod device_schema_upgrade_tests;
#[cfg(test)]
mod sync_bookkeeping_business_tests;
#[cfg(test)]
mod sync_bookkeeping_fixture;
#[cfg(test)]
mod sync_bookkeeping_tests;
#[cfg(test)]
mod hourly_fixture;
#[cfg(test)]
mod legacy_schema_fixture;
#[cfg(test)]
mod device_migration_timing;
#[cfg(test)]
mod daily_parity_tests;
/// 测试夹具的短路径（`merge_tests` 用；长路径会把那一行挤成多行，越过 `check:size`）。
#[cfg(test)]
pub(crate) use legacy_schema_fixture::rewind_to_pre_device_dimension;
