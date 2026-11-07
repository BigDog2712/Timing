//! 后端测试入口（QA 新增，仅 `cargo test` 编入）。
//!
//! 断言来源：`docs/Spec-v1.md` §6 / §9 与 `docs/phase2/IPC-CONTRACT-v2.md`，
//! 以行为（输入→可观测输出/错误码）为准，不绑定实现内部细节。

mod support;

mod appdata_migrate;
mod appdata_migrate_edges;
mod boot_timing;
mod countdown;
mod daily_status;
/* [V0.11.15] 数据根指针与搬迁（指针优先于 optout；`VACUUM INTO` 的参数绑定）。 */
mod data_root_pointer;
mod data_root_transfer;
/* 假 WebDAV 服务器（V0.11.15 从 `md_webdav.rs` 搬出）：`Fake` / `serve` / `serve_412_on_put`。 */
mod fake_webdav;
/* 路由式假服务器（V0.11.15）：409 补建的判据要「目录存不存在」这个真实状态。 */
mod fake_webdav_dir;
mod item;
mod item_batch2;
mod md_backup_restore;
mod md_backup_target;
mod md_cloud_autosync;
mod md_cloud_conflict;
mod md_cloud_folder;
mod md_cloud_pending;
mod md_cloud_round;
mod md_sync;
mod md_sync_disabled_gate;
mod md_sync_duration;
mod md_sync_edges;
mod md_sync_format;
mod md_sync_legacy_config;
mod md_sync_live;
mod md_sync_live_guard;
mod md_sync_notes;
mod md_sync_notes_guard;
mod md_sync_pairing;
mod md_sync_todo_edit;
mod md_sync_todo_export;
mod md_sync_todo_import;
mod md_sync_todos;
mod md_sync_upgrade;
mod md_webdav;
/* MKCOL / 409 补建（V0.11.15，设计 §6.3）。 */
mod md_webdav_dir;
/* `fail_text` 的文案判据（状态码零命中）。 */
mod md_webdav_text;
/* 「写文件」与「建目录」的 URL 必须同源（MKCOL 的 URL 是 PUT 的路径前缀）。 */
mod md_webdav_url;
mod migration;
mod migration_v2;
mod moyu_settings;
mod note;
mod note_pin;
mod plugin_v3_matrix;
mod plugin_v3_wording;
mod portable_dir;
mod portable_dir_qa;
mod portable_dir_qa_md;
mod portable_dir_qa_plugins;
mod portable_dir_qa_source;
mod portable_dir_scan;
mod record;
mod reminder;
#[cfg(target_os = "windows")]
mod secret_dpapi;
mod settings_reference;
mod theme;
mod timer;
mod timer_clock;
mod timer_formula;
mod timer_recover_gap;
mod timer_switch;
mod timer_threshold;
mod timer_todo_link;
mod todo;
mod todo_list;
mod todo_nudge;
mod todo_purge;
mod todo_start;
mod tray_batch2;
mod tray_menu;
mod tray_menu_md_sync;
mod window_geometry;
mod window_spec;
