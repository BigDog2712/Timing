//! TickBar 桌面壳入口（仅装配：插件 / 状态 / 托盘 / 命令 / 窗口事件，无业务）。

mod commands;
mod error;
mod infra;
mod models;
mod repositories;
mod services;
mod state;

// QA 测试模块（仅 `cargo test` 时编入，不入发布产物；见 src/tests/）。
#[cfg(test)]
mod tests;

pub fn run() {
    tauri::Builder::default()
        // 插件（IPC-CONTRACT-v2 附录 A / Spec §4）
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // [V0.2.0] 系统通知（批 2 提醒调度用；本波仅注册，不接线）
        .plugin(tauri_plugin_notification::init())
        // 单实例：重复启动聚焦已有窗口（AC-22）
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = infra::window::show_main(app);
        }))
        // 启动装配：建库 -> 默认设置 -> 状态 -> 托盘 -> 后台落盘
        .setup(|app| infra::setup::setup(app.handle().clone()))
        // K-5：拦截关闭请求 -> 隐藏窗口
        .on_window_event(infra::window::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::item_cmd::list_items,
            commands::item_cmd::create_item,
            commands::item_cmd::update_item,
            commands::item_cmd::archive_item,
            commands::item_cmd::unarchive_item,
            commands::item_cmd::delete_item,
            commands::diary_cmd::diary_get_config,
            commands::diary_cmd::diary_set_config,
            commands::diary_cmd::diary_today,
            commands::diary_cmd::diary_open_today,
            commands::timer_cmd::start_timer,
            commands::timer_cmd::pause_timer,
            commands::timer_cmd::resume_timer,
            commands::timer_cmd::stop_timer,
            commands::timer_cmd::discard_timer,
            commands::daily_status_cmd::daily_status_get,
            commands::daily_status_cmd::daily_status_set,
            commands::timer_cmd::undo_stop,
            commands::timer_cmd::get_timer_state,
            commands::timer_cmd::switch_item,
            commands::timer_cmd::resolve_open_record,
            commands::record_cmd::list_records,
            commands::record_cmd::stats_summary,
            commands::record_cmd::update_record,
            commands::record_cmd::delete_record,
            commands::settings_cmd::get_settings,
            commands::settings_cmd::get_reference_settings,
            commands::settings_cmd::update_reference_settings,
            commands::settings_cmd::update_settings,
            commands::settings_cmd::set_autostart,
            commands::settings_cmd::get_autostart,
            commands::system_cmd::register_shortcut,
            commands::system_cmd::show_window,
            commands::system_cmd::hide_window,
            commands::system_cmd::toggle_window,
            commands::system_cmd::set_always_on_top,
            commands::system_cmd::save_window_position,
            commands::system_cmd::quit_app,
            commands::theme_cmd::theme_get,
            commands::theme_cmd::theme_set,
            commands::theme_cmd::accent_get,
            commands::theme_cmd::accent_set,
            commands::window_cmd::open_settings_window,
            commands::window_cmd::open_todos_window,
            commands::window_cmd::open_timer_window,
            commands::window_cmd::open_note_window,
            commands::window_cmd::close_note_window,
            commands::todo_cmd::todo_create,
            commands::todo_cmd::todo_update,
            commands::todo_cmd::todo_delete,
            commands::todo_cmd::todo_list,
            commands::todo_cmd::todo_toggle,
            // [V0.2.0 批 2] 便利贴 / 倒计时 / 提醒（IPC 40 → 52）
            commands::note_cmd::note_create,
            commands::note_cmd::note_get,
            commands::note_cmd::note_list,
            commands::note_cmd::note_update,
            commands::note_cmd::note_delete,
            commands::timer_cmd::start_countdown,
            commands::countdown_cmd::set_countdown_preset,
            commands::reminder_cmd::reminder_set,
            commands::reminder_cmd::reminder_clear,
            commands::reminder_cmd::reminder_pending,
        ])
        .run(tauri::generate_context!())
        .expect("TickBar 启动失败");
}
