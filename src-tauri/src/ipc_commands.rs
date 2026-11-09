//! 应用级 IPC 命令表：宿主 79 条 + Patina 118 条（后者仅桌面）。
//!
//! **为什么只有一张表**：Tauri 的 `invoke_handler` 是替换语义，`Invoke` 又不 `Clone`，
//! 「宿主表 + Patina 表串成闭包」编不过（E0382）；改用插件注册更糟——插件命令走
//! `plugin:<name>|...` 的 ACL 命名空间，`permissions/window-commands.toml` 里的应用级
//! 白名单对它不生效，前端每条 IPC 都被拒且**没有任何日志**，表现为「页面加载完、
//! 窗口永不 ready」。
//!
//! 所以两边必须共用这一张表。Patina 整块 `#[cfg(desktop)]`（依赖 WebView2 / Win32），
//! 用 `macro_rules!` 让宿主那一长串只写一遍，避免桌面/移动两份清单彼此漂移。
//!
//! 改这里任何一行，都要同步 `src/services/ipc.ts` / `src/types/domain/ipc.ts` /
//! `src/mocks/browserMockPlugins.ts` 与 `docs/phase2/IPC-CONTRACT-v2.md`（四面契约）。

use tauri::Wry;

/// 命令表模板。`$extra` 是平台专属命令（目前只有 Patina），拼在宿主命令之前——
/// 两边命令名已核对互不重复，先后顺序不影响结果。
macro_rules! define_invoke_handler {
    ($($extra:path,)*) => {
        pub fn invoke_handler() -> impl Fn(tauri::ipc::Invoke<Wry>) -> bool + Send + Sync + 'static {
            tauri::generate_handler![
                $($extra,)*
            crate::commands::item_cmd::list_items,
            crate::commands::item_cmd::create_item,
            crate::commands::item_cmd::update_item,
            crate::commands::item_cmd::archive_item,
            crate::commands::item_cmd::unarchive_item,
            crate::commands::item_cmd::delete_item,
            /* [V0.3.4] 日记域四条命令（diary_get_config / diary_set_config / diary_today /
            diary_open_today）随日记模块整体下架删除，见 ADR-023。 */
            crate::commands::timer_cmd::start_timer,
            crate::commands::timer_cmd::pause_timer,
            crate::commands::timer_cmd::resume_timer,
            crate::commands::timer_cmd::stop_timer,
            crate::commands::timer_cmd::discard_timer,
            crate::commands::daily_status_cmd::daily_status_get,
            crate::commands::daily_status_cmd::daily_status_set,
            crate::commands::timer_cmd::undo_stop,
            crate::commands::timer_cmd::get_timer_state,
            crate::commands::timer_cmd::switch_item,
            crate::commands::timer_cmd::resolve_open_record,
            crate::commands::record_cmd::list_records,
            crate::commands::record_cmd::stats_summary,
            crate::commands::record_cmd::update_record,
            crate::commands::record_cmd::delete_record,
            crate::commands::settings_cmd::get_settings,
            crate::commands::settings_cmd::get_reference_settings,
            crate::commands::settings_cmd::update_reference_settings,
            crate::commands::settings_cmd::update_settings,
            crate::commands::settings_cmd::set_autostart,
            crate::commands::settings_cmd::get_autostart,
            crate::commands::system_cmd::show_window,
            crate::commands::system_cmd::main_work_area,
            crate::commands::system_cmd::main_window_rect,
            crate::commands::system_cmd::hide_window,
            crate::commands::system_cmd::toggle_window,
            crate::commands::system_cmd::save_window_position,
            crate::commands::system_cmd::quit_app,
            crate::commands::theme_cmd::theme_get,
            crate::commands::theme_cmd::theme_set,
            crate::commands::theme_cmd::accent_get,
            crate::commands::theme_cmd::accent_set,
            crate::commands::window_cmd::open_settings_window,
            crate::commands::window_cmd::open_todos_window,
            crate::commands::window_cmd::open_timer_window,
            crate::commands::window_cmd::open_note_window,
            crate::commands::window_cmd::close_note_window,
            crate::commands::todo_cmd::todo_create,
            crate::commands::todo_cmd::todo_update,
            crate::commands::todo_cmd::todo_delete,
            crate::commands::todo_cmd::todo_list,
            crate::commands::todo_cmd::todo_toggle,
            crate::commands::todo_cmd::todo_start,
            // [V0.2.0 批 2] 便利贴 / 倒计时 / 提醒（IPC 40 → 52）
            crate::commands::note_cmd::note_create,
            crate::commands::note_cmd::note_get,
            crate::commands::note_cmd::note_list,
            crate::commands::note_cmd::note_update,
            crate::commands::note_cmd::note_delete,
            crate::commands::timer_cmd::start_countdown,
            crate::commands::countdown_cmd::set_countdown_preset,
            crate::commands::reminder_cmd::reminder_set,
            crate::commands::reminder_cmd::reminder_clear,
            crate::commands::reminder_cmd::reminder_pending,
            // [V0.3.2] 插件域（声明式插件：读 `<插件目录>/plugin.json` 启动头）
            crate::commands::plugin_cmd::plugin_list,
            crate::commands::plugin_cmd::plugin_open_dir,
            // [V0.4.0] Markdown 同步（插件 API v2 的宿主实现）
            crate::commands::md_sync_cmd::md_sync_get,
            crate::commands::md_sync_cmd::md_sync_save,
            crate::commands::md_sync_cmd::md_sync_run,
            crate::commands::md_sync_cmd::md_sync_open,
            /* [V0.11.13] 云端第二落点（ADR-061）：测试连接 / 备份列表 / 备份恢复。
            移动端同名注册，`md_backup_*` 在那里回 `MD_SYNC_CONFIG_INVALID`。 */
            crate::commands::md_sync_cmd::md_sync_test,
            crate::commands::md_sync_cmd::md_backup_list,
            crate::commands::md_sync_cmd::md_backup_restore,
            /* [V0.11.15] 数据管理重组：数据根三条 + 备份「打开」（命令 74 → 78）。
            不加 `#[cfg]` —— 命令名就是契约面，手机端同名注册、内部回 IO_ERROR。 */
            crate::commands::data_root_cmd::data_root_get,
            crate::commands::data_root_cmd::data_root_change,
            crate::commands::data_root_cmd::data_root_open,
            crate::commands::md_sync_cmd::md_backup_open,
            // [V0.12.0] 手机端原生能力（SAF 目录 / 悬浮条）；桌面侧四条是桩
            crate::commands::mobile_cmd::md_saf_pick,
            crate::commands::mobile_cmd::md_saf_status,
            crate::commands::mobile_cmd::overlay_set,
            crate::commands::mobile_cmd::overlay_status,
            // [V0.11.23] 备份导出（命令 78 → 79）；桌面侧是 `mobile_only` 桩
            crate::commands::mobile_cmd::md_backup_export,
            // [V0.5.0] 迁移可见性（命令 65 → 67，见 ADR-037）
            crate::commands::migration_cmd::get_migration_info,
            crate::commands::migration_cmd::open_legacy_dir,
            ]
        }
    };
}

#[cfg(desktop)]
define_invoke_handler![
    crate::patina::commands::tool_notifications::cmd_get_tool_presentation,
    crate::patina::commands::tool_notifications::cmd_save_tool_notification_preferences,
    crate::patina::commands::tool_notifications::cmd_tool_presentation_action,
    crate::patina::commands::tool_notifications::cmd_tool_presentation_ready,
    crate::patina::commands::mini_window::cmd_open_mini_window,
    crate::patina::commands::mini_window::cmd_get_mini_window_snapshot,
    crate::patina::commands::mini_window::cmd_mini_window_action,
    crate::patina::commands::persistence_read::cmd_get_setting_rows,
    crate::patina::commands::persistence_read::cmd_get_history_range_rows,
    crate::patina::commands::persistence_read::cmd_get_executable_icon_rows,
    crate::patina::commands::persistence_read::cmd_get_earliest_activity_start_time,
    crate::patina::commands::persistence_read::cmd_get_recorded_executable_names,
    crate::patina::commands::persistence_read::cmd_get_web_activity_segment_rows,
    crate::patina::commands::persistence_read::cmd_get_observed_web_domain_rows,
    crate::patina::commands::persistence_read::cmd_get_web_favicon_rows,
    crate::patina::commands::activity_read_model::cmd_get_recorded_app_catalog_page,
    crate::patina::commands::activity_read_model::cmd_get_activity_aggregate_range,
    crate::patina::commands::activity_read_model::cmd_get_activity_read_model_status,
    crate::patina::commands::tracking::get_current_active_window,
    crate::patina::commands::tracking::get_current_tracking_snapshot,
    crate::patina::commands::tracking::cmd_get_tracker_health_snapshot,
    crate::patina::commands::tracking::cmd_set_afk_threshold,
    crate::patina::commands::settings::cmd_set_desktop_behavior,
    crate::patina::commands::settings::cmd_set_launch_behavior,
    crate::patina::commands::settings::cmd_commit_app_settings,
    crate::patina::commands::settings::cmd_migrate_history_timeline_mode,
    crate::patina::commands::settings::cmd_commit_classification_settings,
    crate::patina::commands::settings::cmd_get_web_links,
    crate::patina::commands::settings::cmd_get_legacy_classification_apps,
    crate::patina::commands::export::cmd_pick_export_save_file,
    crate::patina::commands::export::cmd_export_data,
    crate::patina::commands::export::cmd_get_scheduled_export_snapshot,
    crate::patina::commands::export::cmd_pick_scheduled_export_directory,
    crate::patina::commands::export::cmd_save_scheduled_export_config,
    crate::patina::commands::import::cmd_pick_canonical_import_file,
    crate::patina::commands::import::cmd_pick_external_import_file,
    crate::patina::commands::import::cmd_preview_canonical_import,
    crate::patina::commands::import::cmd_commit_canonical_import,
    crate::patina::commands::import::cmd_destructure_external_data,
    crate::patina::commands::import::cmd_list_import_batches,
    crate::patina::commands::import::cmd_delete_import_batch,
    crate::patina::commands::tools::cmd_get_tools_snapshot,
    crate::patina::commands::tools::cmd_get_focus_history,
    crate::patina::commands::tools::cmd_get_tool_alerts,
    crate::patina::commands::tools::cmd_dismiss_tool_alert,
    crate::patina::commands::tools::cmd_extend_activity_reminder,
    crate::patina::commands::tools::cmd_resolve_reminder_alert,
    crate::patina::commands::window::cmd_show_desktop,
    crate::patina::commands::tools::cmd_create_reminder,
    crate::patina::commands::tools::cmd_cancel_reminder,
    crate::patina::commands::tools::cmd_update_reminder,
    crate::patina::commands::tools::cmd_create_activity_reminder_rule,
    crate::patina::commands::tools::cmd_disable_activity_reminder_rule,
    crate::patina::commands::tools::cmd_set_activity_reminder_enabled,
    crate::patina::commands::tools::cmd_update_activity_reminder_limit,
    crate::patina::commands::tools::cmd_start_pomodoro,
    crate::patina::commands::tools::cmd_pomodoro_task,
    crate::patina::commands::tools::cmd_free_focus,
    crate::patina::commands::tools::cmd_pause_pomodoro,
    crate::patina::commands::tools::cmd_resume_pomodoro,
    crate::patina::commands::tools::cmd_skip_pomodoro_phase,
    crate::patina::commands::tools::cmd_reset_pomodoro,
    crate::patina::commands::mini_window::cmd_get_mini_bootstrap_snapshot,
    crate::patina::commands::mini_window::cmd_get_mini_presentation_snapshot,
    crate::patina::commands::mini_window::cmd_get_mini_activity_snapshot,
    crate::patina::commands::window::cmd_show_main_window,
    crate::patina::commands::window::cmd_minimize_main_window,
    crate::patina::commands::window::cmd_e2e_destroy_hidden_main_window,
    crate::patina::commands::window::cmd_get_main_window_render_token,
    crate::patina::commands::window::cmd_mark_main_window_ready,
    crate::patina::commands::window::cmd_take_main_tools_target,
    crate::patina::commands::update::cmd_get_update_snapshot,
    crate::patina::commands::update::cmd_check_for_updates,
    crate::patina::commands::update::cmd_download_update,
    crate::patina::commands::update::cmd_install_update,
    crate::patina::commands::web_activity::cmd_get_web_activity_bridge_snapshot,
    crate::patina::commands::web_activity_analysis::cmd_get_web_activity_aggregate_range,
    crate::patina::commands::backup::cmd_pick_backup_save_file,
    crate::patina::commands::backup::cmd_pick_backup_file,
    crate::patina::commands::backup::cmd_get_scheduled_backup_snapshot,
    crate::patina::commands::backup::cmd_pick_scheduled_backup_directory,
    crate::patina::commands::backup::cmd_save_scheduled_backup_config,
    crate::patina::commands::backup::cmd_preview_backup,
    crate::patina::commands::backup::cmd_export_backup,
    crate::patina::commands::backup::cmd_restore_backup,
    crate::patina::commands::backup::cmd_reveal_webdav_backup_secret,
    crate::patina::commands::backup::cmd_get_remote_backup_config_snapshot,
    crate::patina::commands::backup::cmd_test_webdav_backup_target,
    crate::patina::commands::backup::cmd_upload_webdav_backup,
    crate::patina::commands::backup::cmd_list_webdav_backups,
    crate::patina::commands::backup::cmd_download_webdav_backup,
    crate::patina::commands::backup::cmd_delete_remote_backup_temp,
    crate::patina::commands::storage::cmd_get_storage_snapshot,
    crate::patina::commands::storage::cmd_pick_storage_directory,
    crate::patina::commands::storage::cmd_preview_storage_migration,
    crate::patina::commands::storage::cmd_preview_webview_cache_migration,
    crate::patina::commands::storage::cmd_preview_restore_default_storage_migration,
    crate::patina::commands::storage::cmd_preview_restore_default_webview_cache_migration,
    crate::patina::commands::storage::cmd_restart_and_apply_storage_migration,
    crate::patina::commands::storage::cmd_restart_and_apply_webview_cache_migration,
    crate::patina::commands::storage::cmd_restart_and_apply_restore_default_storage_migration,
    crate::patina::commands::storage::cmd_restart_and_apply_restore_default_webview_cache_migration,
    crate::patina::commands::storage::cmd_restart_and_clear_webview_cache,
    crate::patina::commands::storage::cmd_open_storage_directory,
    crate::patina::commands::persistence::cmd_delete_sessions_before,
    crate::patina::commands::persistence::cmd_delete_sessions_by_exe_names,
    crate::patina::commands::persistence::cmd_classification_object_deletion,
    crate::patina::commands::persistence::cmd_delete_sessions_by_exe_names_between,
    crate::patina::commands::persistence::cmd_delete_web_activity_segments_by_domain,
    crate::patina::commands::persistence::cmd_save_remote_backup_settings,
    crate::patina::commands::persistence::cmd_save_remote_backup_last_backup_at,
    crate::patina::commands::persistence::cmd_clear_remote_backup_settings,
    crate::patina::commands::persistence::cmd_save_data_bootstrap_snapshot_payload,
    crate::patina::commands::persistence::cmd_clear_data_bootstrap_snapshot_payload,
    crate::patina::commands::persistence::cmd_save_history_bootstrap_snapshot_payload,
    crate::patina::commands::persistence::cmd_clear_history_bootstrap_snapshot_payload,
    crate::patina::commands::diagnostics::cmd_get_resource_diagnostics,
    /* [V0.12.0 Patina 融合] 打开时间统计窗口的**宿主侧**入口（设置页用）。放在这一段
    只是因为它必须 `#[cfg(desktop)]`（Patina 子系统只在桌面上编进来）；它走的是宿主
    `IpcApi` 契约，不带 patina 前缀，也不受 window-commands 的 ACL 限制。
    见 `commands::window_cmd` 里那条命令的注释。 */
    crate::commands::window_cmd::open_patina_window,
];

#[cfg(not(desktop))]
define_invoke_handler![];
