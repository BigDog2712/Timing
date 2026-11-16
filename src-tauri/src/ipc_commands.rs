//! 应用级 IPC 命令表：宿主 92 条 + Patina 126 条（后者仅桌面）。
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
            /* [0.14] 分类目录读口（两窗「事项分类选用」共用；桌面读活动库，手机回空目录）。 */
            crate::commands::category_catalog_cmd::list_category_catalog,
            /* [0.13.x] 事项 ↔ 应用绑定（宿主段：业务库 item_app 表）。
               四条都是两端可用的普通命令，不进 Patina 段。 */
            crate::commands::item_app_cmd::list_item_apps,
            crate::commands::item_app_cmd::list_items_for_app,
            crate::commands::item_app_cmd::bind_item_app,
            crate::commands::item_app_cmd::unbind_item_app,
            /* [V0.3.4] 日记域四条命令（diary_get_config / diary_set_config / diary_today /
            diary_open_today）随日记模块整体下架删除，见 ADR-023。 */
            crate::commands::timer_cmd::start_timer,
            crate::commands::timer_cmd::pause_timer,
            crate::commands::timer_cmd::resume_timer,
            crate::commands::timer_cmd::stop_timer,
            crate::commands::timer_cmd::discard_timer,
            crate::commands::daily_status_cmd::daily_status_get,
            crate::commands::daily_status_cmd::daily_status_set,
            crate::commands::usage_cmd::usage_stats_get,
            crate::commands::usage_cmd::usage_stats_settings,
            crate::commands::timer_cmd::undo_stop,
            crate::commands::timer_cmd::get_timer_state,
            crate::commands::timer_cmd::switch_item,
            crate::commands::timer_cmd::resolve_open_record,
            crate::commands::record_cmd::create_record,
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
            /* [0.13 fix] 药丸冷启动「主动取一次前台」用：引擎那次广播早于前端订阅，丢了就
               再也不发（详见 `commands/window_cmd.rs` 里那条命令的注释）。 */
            crate::commands::window_cmd::get_foreground_window,
            /* [0.13] 绑定的应用进程退出时结束这一段自动接管（桌面真实现 / 手机 Ok(())）。
               注册点无条件写在这里：命令名就是契约面，手机端同名注册。 */
            crate::commands::bound_process_watch_cmd::set_bound_process_watch,
            crate::commands::todo_cmd::todo_create,
            // [0.13 · 1.7] 批量创建（单事务 1..=60）
            crate::commands::todo_cmd::todo_create_batch,
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
            /* [T03] md 覆盖提醒：列待裁决冲突 / 执行一次裁决。 */
            crate::commands::md_sync_cmd::md_sync_decisions,
            crate::commands::md_sync_cmd::md_sync_resolve,
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
    // [设备维度 P1] 日级双口径：Patina 段命令，不计入宿主 79 条契约（但文档总数要 +1）。
    crate::commands::activity::activity_read_model_cmd::cmd_get_activity_daily_totals,
    /* [0.13.x] 应用分类绑定（活动库 app_category 表）：列表 / 设 / 删。 */
    crate::commands::activity::attribution_cmd::cmd_list_app_categories,
    crate::commands::activity::attribution_cmd::cmd_set_app_category,
    crate::commands::activity::attribution_cmd::cmd_remove_app_category,
    /* [0.13.x] 旧 KV 绑定 → 新表的一次性回填（守卫键保证只跑一次）。 */
    crate::commands::activity::attribution_cmd::cmd_backfill_legacy_bindings,
    /* [0.13.x] 事项块投影 + 子记录切片（时间轴点开一个块）。 */
    crate::commands::activity::focus_block_cmd::cmd_project_focus_blocks,
    crate::commands::activity::focus_block_cmd::cmd_list_focus_blocks,
    crate::commands::activity::focus_block_cmd::cmd_get_block_detail,
    crate::commands::activity::focus_block_cmd::cmd_get_item_timeline,
    crate::commands::activity::tool_notifications_cmd::cmd_get_tool_presentation,
    crate::commands::activity::tool_notifications_cmd::cmd_save_tool_notification_preferences,
    crate::commands::activity::tool_notifications_cmd::cmd_tool_presentation_action,
    crate::commands::activity::tool_notifications_cmd::cmd_tool_presentation_ready,
    crate::commands::activity::mini_window_cmd::cmd_open_mini_window,
    crate::commands::activity::mini_window_cmd::cmd_get_mini_window_snapshot,
    crate::commands::activity::mini_window_cmd::cmd_mini_window_action,
    crate::commands::activity::persistence_read_cmd::cmd_get_setting_rows,
    crate::commands::activity::persistence_read_cmd::cmd_get_history_range_rows,
    crate::commands::activity::persistence_read_cmd::cmd_get_executable_icon_rows,
    crate::commands::activity::persistence_read_cmd::cmd_get_earliest_activity_start_time,
    crate::commands::activity::persistence_read_cmd::cmd_get_recorded_executable_names,
    crate::commands::activity::persistence_read_cmd::cmd_get_web_activity_segment_rows,
    crate::commands::activity::persistence_read_cmd::cmd_get_observed_web_domain_rows,
    crate::commands::activity::persistence_read_cmd::cmd_get_web_favicon_rows,
    crate::commands::activity::activity_read_model_cmd::cmd_get_recorded_app_catalog_page,
    crate::commands::activity::activity_read_model_cmd::cmd_get_activity_aggregate_range,
    crate::commands::activity::activity_read_model_cmd::cmd_get_activity_read_model_status,
    crate::commands::activity::tracking_cmd::get_current_active_window,
    crate::commands::activity::tracking_cmd::get_current_tracking_snapshot,
    crate::commands::activity::tracking_cmd::cmd_get_tracker_health_snapshot,
    crate::commands::activity::tracking_cmd::cmd_set_afk_threshold,
    crate::commands::activity::settings_cmd::cmd_set_desktop_behavior,
    crate::commands::activity::settings_cmd::cmd_set_launch_behavior,
    crate::commands::activity::settings_cmd::cmd_commit_app_settings,
    crate::commands::activity::settings_cmd::cmd_migrate_history_timeline_mode,
    crate::commands::activity::settings_cmd::cmd_commit_classification_settings,
    crate::commands::activity::settings_cmd::cmd_get_web_links,
    crate::commands::activity::settings_cmd::cmd_get_legacy_classification_apps,
    crate::commands::activity::export_cmd::cmd_pick_export_save_file,
    crate::commands::activity::export_cmd::cmd_export_data,
    crate::commands::activity::export_cmd::cmd_get_scheduled_export_snapshot,
    crate::commands::activity::export_cmd::cmd_pick_scheduled_export_directory,
    crate::commands::activity::export_cmd::cmd_save_scheduled_export_config,
    crate::commands::activity::import_cmd::cmd_pick_canonical_import_file,
    crate::commands::activity::import_cmd::cmd_pick_external_import_file,
    crate::commands::activity::import_cmd::cmd_preview_canonical_import,
    crate::commands::activity::import_cmd::cmd_commit_canonical_import,
    crate::commands::activity::import_cmd::cmd_destructure_external_data,
    crate::commands::activity::import_cmd::cmd_list_import_batches,
    crate::commands::activity::import_cmd::cmd_delete_import_batch,
    /* [批 2] 全额数据包：导出/导入单个 JSON（含事项、计时、便利贴、待办、应用活动、手机端数据）。 */
    crate::commands::activity::bundle_cmd::cmd_pick_full_bundle_save_file,
    crate::commands::activity::bundle_cmd::cmd_export_full_bundle,
    crate::commands::activity::bundle_cmd::cmd_pick_full_bundle_file,
    crate::commands::activity::bundle_cmd::cmd_inspect_full_bundle,
    crate::commands::activity::bundle_cmd::cmd_import_full_bundle,
    crate::commands::activity::tools_cmd::cmd_get_tools_snapshot,
    crate::commands::activity::tools_cmd::cmd_get_focus_history,
    crate::commands::activity::tools_cmd::cmd_get_tool_alerts,
    crate::commands::activity::tools_cmd::cmd_dismiss_tool_alert,
    crate::commands::activity::tools_cmd::cmd_extend_activity_reminder,
    crate::commands::activity::tools_cmd::cmd_resolve_reminder_alert,
    crate::commands::activity::window_cmd::cmd_show_desktop,
    crate::commands::activity::tools_cmd::cmd_create_reminder,
    crate::commands::activity::tools_cmd::cmd_cancel_reminder,
    crate::commands::activity::tools_cmd::cmd_update_reminder,
    crate::commands::activity::tools_cmd::cmd_create_activity_reminder_rule,
    crate::commands::activity::tools_cmd::cmd_disable_activity_reminder_rule,
    crate::commands::activity::tools_cmd::cmd_set_activity_reminder_enabled,
    crate::commands::activity::tools_cmd::cmd_update_activity_reminder_limit,
    crate::commands::activity::tools_cmd::cmd_start_pomodoro,
    crate::commands::activity::tools_cmd::cmd_pomodoro_task,
    crate::commands::activity::tools_cmd::cmd_free_focus,
    crate::commands::activity::tools_cmd::cmd_pause_pomodoro,
    crate::commands::activity::tools_cmd::cmd_resume_pomodoro,
    crate::commands::activity::tools_cmd::cmd_skip_pomodoro_phase,
    crate::commands::activity::tools_cmd::cmd_reset_pomodoro,
    crate::commands::activity::mini_window_cmd::cmd_get_mini_bootstrap_snapshot,
    crate::commands::activity::mini_window_cmd::cmd_get_mini_presentation_snapshot,
    crate::commands::activity::mini_window_cmd::cmd_get_mini_activity_snapshot,
    crate::commands::activity::window_cmd::cmd_show_main_window,
    crate::commands::activity::window_cmd::cmd_minimize_main_window,
    crate::commands::activity::window_cmd::cmd_e2e_destroy_hidden_main_window,
    crate::commands::activity::window_cmd::cmd_get_main_window_render_token,
    crate::commands::activity::window_cmd::cmd_mark_main_window_ready,
    crate::commands::activity::window_cmd::cmd_take_main_tools_target,
    crate::commands::activity::web_activity_cmd::cmd_get_web_activity_bridge_snapshot,
    crate::commands::activity::web_activity_analysis_cmd::cmd_get_web_activity_aggregate_range,
    crate::commands::activity::storage_cmd::cmd_get_storage_snapshot,
    crate::commands::activity::storage_cmd::cmd_pick_storage_directory,
    crate::commands::activity::storage_cmd::cmd_pick_markdown_file,
    crate::commands::activity::storage_cmd::cmd_preview_storage_migration,
    crate::commands::activity::storage_cmd::cmd_preview_webview_cache_migration,
    crate::commands::activity::storage_cmd::cmd_preview_restore_default_storage_migration,
    crate::commands::activity::storage_cmd::cmd_preview_restore_default_webview_cache_migration,
    crate::commands::activity::storage_cmd::cmd_restart_and_apply_storage_migration,
    crate::commands::activity::storage_cmd::cmd_restart_and_apply_webview_cache_migration,
    crate::commands::activity::storage_cmd::cmd_restart_and_apply_restore_default_storage_migration,
    crate::commands::activity::storage_cmd::cmd_restart_and_apply_restore_default_webview_cache_migration,
    crate::commands::activity::storage_cmd::cmd_restart_and_clear_webview_cache,
    crate::commands::activity::storage_cmd::cmd_open_storage_directory,
    crate::commands::activity::persistence_cmd::cmd_delete_sessions_before,
    crate::commands::activity::persistence_cmd::cmd_delete_sessions_by_exe_names,
    crate::commands::activity::persistence_cmd::cmd_classification_object_deletion,
    crate::commands::activity::persistence_cmd::cmd_delete_sessions_by_exe_names_between,
    crate::commands::activity::persistence_cmd::cmd_delete_web_activity_segments_by_domain,
    crate::commands::activity::persistence_cmd::cmd_save_remote_backup_settings,
    crate::commands::activity::persistence_cmd::cmd_save_remote_backup_last_backup_at,
    crate::commands::activity::persistence_cmd::cmd_clear_remote_backup_settings,
    crate::commands::activity::persistence_cmd::cmd_save_data_bootstrap_snapshot_payload,
    crate::commands::activity::persistence_cmd::cmd_clear_data_bootstrap_snapshot_payload,
    crate::commands::activity::persistence_cmd::cmd_save_history_bootstrap_snapshot_payload,
    crate::commands::activity::persistence_cmd::cmd_clear_history_bootstrap_snapshot_payload,
    crate::commands::activity::diagnostics_cmd::cmd_get_resource_diagnostics,
    /* [V0.12.0 Patina 融合] 打开时间统计窗口的**宿主侧**入口（设置页用）。放在这一段
    只是因为它必须 `#[cfg(desktop)]`（Patina 子系统只在桌面上编进来）；它走的是宿主
    `IpcApi` 契约，不带 patina 前缀，也不受 window-commands 的 ACL 限制。
    见 `commands::window_cmd` 里那条命令的注释。 */
    crate::commands::window_cmd::open_activity_window,
    /* [0.13] 手柄自定义动作（启动应用 / 发送快捷键）。桌面独占：手机没有「把按键发给
    当前前台应用」这件事，也没有可启动的外部程序 —— 前端在手机上不给这两个选项，
    命令也就不注册（注册了只能回 IO_ERROR 的假成功更像缺陷）。 */
    crate::commands::system_cmd::run_handle_custom_action,
    /* [R1] 「启动应用」的授权入口。单独一条命令的理由不是「拆得干净」，而是**权限来源**：
       只有这条会弹原生对话框并写授权名单，`run_handle_custom_action` 只读它。
       两者合一的话，前端传进来的路径就同时承担「申请」与「执行」两个语义。 */
    crate::commands::system_cmd::pick_custom_launch_target,
];

#[cfg(not(desktop))]
define_invoke_handler![];
