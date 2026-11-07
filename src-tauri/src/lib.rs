//! Timing 桌面壳入口（仅装配：插件 / 状态 / 托盘 / 命令 / 窗口事件，无业务）。
//!
//! 分层（依赖只能向下）：
//! `platform`（叶子）→ `infra`（平台适配）→ `services`（业务）
//! → `app`（装配：事件/托盘/启动/诊断）/ `jobs`（调度）→ `commands`（IPC 入口）。
//! 机械校验：`npm run check:contract` + CI 里的两条 grep（见 AGENTS.md）。

/* 移动端允许 dead_code（V1-Android）：
md-sync 整域（repositories / services / infra 的 md_*）在 Android 上不接线 —— 4 条命令
是桩、调度器不 spawn，但源码仍两平台共用（不另开一套移动分支）。同理，托盘快照、
窗口几何、`WINDOW_LIMIT_EXCEEDED` 之类「没有触发点但契约里必须留着」的定义，在移动端
都只会被判定为未使用。逐个模块加 `#[cfg]` 让同一份源码分叉更糟：桌面侧才是唯一维护面，
移动端只是「这份代码暂时用不到」。桌面构建不受影响（clippy -D warnings 仍会抓桌面死码）。 */
#![cfg_attr(mobile, allow(dead_code))]

mod app;
mod commands;
mod error;
mod infra;
mod jobs;
mod models;
mod platform;
mod repositories;
mod services;
mod state;

// QA 测试模块（仅 `cargo test` 时编入，不入发布产物；见 src/tests/）。
#[cfg(test)]
mod tests;

/// 应用入口。
///
/// `mobile_entry_point` 是 Android / iOS 的**必需**属性：移动端由原生侧
/// （`MainActivity`）回调这里，没有 `main()` 可走。桌面侧该属性不展开，行为不变。
/// 移动端原生桥插件。
///
/// 它**不向前端暴露任何命令**（前端走 `commands::mobile_cmd` 的普通命令）；唯一作用是把
/// Kotlin 的 `TimingNativePlugin` 注册进 `PluginManager`，并交出一个 `PluginHandle`
/// 供 Rust 侧 `run_mobile_plugin_async` 调用。Kotlin 侧同名类写在
/// `src-tauri/gen/android/app/src/main/java/com/timing/app/TimingNativePlugin.kt`。
///
/// [V0.11.13] **不留泛型 `R`**：插件体里要调 `infra::secret::install_mobile`，而它持有
/// 一个 `PluginHandle<Wry>`（`register_android_plugin` 只在 `Wry` 上实现，没有别的
/// 运行时可拿）。带泛型时 `setup` 闭包会把 `R` 钉成 `Wry`，与返回类型 `TauriPlugin<R>`
/// 冲突（E0308，Android 上硬失败）。`Builder` 本身就是 `Builder<Wry>`，所以这里写死
/// `Wry` 与调用点一致，桌面侧根本不编这一段。
#[cfg(target_os = "android")]
fn mobile_bridge_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    use tauri::Manager;

    tauri::plugin::Builder::new("timing-native")
        .setup(|app, api| {
            let handle = api.register_android_plugin("com.timing.app", "TimingNativePlugin")?;
            /* [V0.11.13] 凭据存储要 `PluginHandle`，只有这里拿得到；桌面在 `bootstrap`
            里装（数据根决定的 DPAPI 落点）。顺序无关：两条路径互斥。 */
            infra::secret::install_mobile((*app).clone(), handle.clone());
            app.manage(infra::native_bridge::NativeBridge::new(handle));
            Ok(())
        })
        .build()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 冷启动计时起点（T17）：越靠近进程入口越准。这里比 `Builder` 早，也早于任何插件初始化。
    platform::boot_timing::start();

    /* [V0.5.0] 数据目录迁移：必须在这里，**早于 `Builder::run()`**。
    理由（ARCHITECTURE §1.3.1）：`tauri-2.12.4` 的 `setup` 钩子是「先按 config 建窗口、
    再调用户钩子」，而 window-state 插件在窗口创建那一刻就把位置回填了 —— 迁移若写在
    `setup` 里，首启永远拿到「新的空目录 + 默认窗口位置」，M-11 必失败。

    `generate_context!()` 提前到此处：`Context::config()` 是公开 API，identifier 与
    productName 都从它读（**不写常量**），阶段二改 `tauri.conf.json` 后迁移目标目录与
    自启值名自动跟随，永不与打包配置漂移。ctx 在末行 `builder.run(ctx)` 被消费。 */
    let ctx = tauri::generate_context!();

    #[cfg(desktop)]
    {
        let identifier = ctx.config().identifier.clone();
        let paths = infra::appdata_migrate::Paths::resolve(&identifier);
        if matches!(
            app::preboot::prepare(paths, &identifier),
            app::preboot::BootChoice::Abort
        ) {
            /* 事件循环还没启动：进程直接退出即可，无需清理任何东西。
            用专门的退出码，便于从「应用一闪即退」里区分出「用户选了退出」。 */
            std::process::exit(app::preboot::EXIT_MIGRATION_ABORTED);
        }
        platform::boot_timing::mark("preboot");

        /* [V0.11.6] 数据 / 插件落点（ADR-050）：必须排在品牌改名迁移**之后**
        （品牌迁移的目标恒在 `%APPDATA%` 内，先把它做完，落点搬运才有一份确定的源），
        又在 `Builder::default()` **之前**（数据根是日志 / 备份 / 建库的入参）。
        同一段 `identifier` 复用，不再重新 clone 一份——两处顺序依赖，写两个 block
        最容易在改动时把先后颠倒。 */
        match app::portable_boot::prepare(&identifier) {
            app::portable_boot::BootChoice::Abort => {
                std::process::exit(app::preboot::EXIT_MIGRATION_ABORTED)
            }
            app::portable_boot::BootChoice::NoDataDir => {
                std::process::exit(app::portable_boot::EXIT_NO_DATA_DIR)
            }
            app::portable_boot::BootChoice::NoWebView2 => {
                std::process::exit(app::portable_boot::EXIT_NO_WEBVIEW2)
            }
            app::portable_boot::BootChoice::Proceed => {}
        }
        platform::boot_timing::mark("portable_boot");
    }

    let builder = tauri::Builder::default();

    /* 桌面独占插件（V1-Android）：这三个 crate 在 Android 上无实现，
    依赖已移入 `Cargo.toml` 的桌面 target 段，注册点也必须同步门控。
    用「重新绑定」而不是给链式调用加 `#[cfg]`：属性只能挂在语句上，挂不到调用链中间。 */
    #[cfg(desktop)]
    let builder = builder
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        // [V0.2.10] 事项窗的默认位置是「主条正下方」，由 `open_panel_window` 每次现算；
        // 不让 window-state 把上次的旧坐标盖回来（它会覆盖 builder 的 position）。
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state(infra::window_spec::TODOS.label)
                .build(),
        )
        // 单实例：重复启动聚焦已有窗口（AC-22）。Android 系统本就单实例，无需该插件。
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            let _ = infra::window::show_main(app);
        }));

    /* 移动端原生桥（Android 专属）：SAF 目录与悬浮窗由 Kotlin 实现，Rust 经此调用。
    桌面没有原生侧可调，`commands::mobile_cmd` 的桌面实现全是桩。 */
    #[cfg(target_os = "android")]
    let builder = builder.plugin(mobile_bridge_plugin());

    let builder = builder
        // 插件（IPC-CONTRACT-v2 附录 A / Spec §4）
        // v0.3 起移除 `plugin-sql` / `plugin-store`：前端从未引用它们，但 capability
        // 曾放行 `sql:allow-execute` / `store:allow-set`，等于给前端留了一条绕过四层
        // 直接改库的通道（ADR-015）。数据访问统一走 commands -> services -> repositories。
        // [V0.2.0] 系统通知（批 2 提醒调度用；本波仅注册，不接线）——两平台通用
        .plugin(tauri_plugin_notification::init())
        // [V0.4.0] 原生文件夹选择（设置 → 同步；只开 dialog:allow-open）——两平台通用
        .plugin(tauri_plugin_dialog::init())
        // 启动装配：日志 -> 建库 -> 默认设置 -> 状态 -> 托盘 -> 诊断 -> 调度器
        .setup(|app| app::bootstrap::setup(app.handle().clone()))
        .invoke_handler(tauri::generate_handler![
            commands::item_cmd::list_items,
            commands::item_cmd::create_item,
            commands::item_cmd::update_item,
            commands::item_cmd::archive_item,
            commands::item_cmd::unarchive_item,
            commands::item_cmd::delete_item,
            /* [V0.3.4] 日记域四条命令（diary_get_config / diary_set_config / diary_today /
            diary_open_today）随日记模块整体下架删除，见 ADR-023。 */
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
            commands::system_cmd::show_window,
            commands::system_cmd::main_work_area,
            commands::system_cmd::main_window_rect,
            commands::system_cmd::hide_window,
            commands::system_cmd::toggle_window,
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
            commands::todo_cmd::todo_start,
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
            // [V0.3.2] 插件域（声明式插件：读 `<插件目录>/plugin.json` 启动头）
            commands::plugin_cmd::plugin_list,
            commands::plugin_cmd::plugin_open_dir,
            // [V0.4.0] Markdown 同步（插件 API v2 的宿主实现）
            commands::md_sync_cmd::md_sync_get,
            commands::md_sync_cmd::md_sync_save,
            commands::md_sync_cmd::md_sync_run,
            commands::md_sync_cmd::md_sync_open,
            /* [V0.11.13] 云端第二落点（ADR-061）：测试连接 / 备份列表 / 备份恢复。
            移动端同名注册，`md_backup_*` 在那里回 `MD_SYNC_CONFIG_INVALID`。 */
            commands::md_sync_cmd::md_sync_test,
            commands::md_sync_cmd::md_backup_list,
            commands::md_sync_cmd::md_backup_restore,
            /* [V0.11.15] 数据管理重组：数据根三条 + 备份「打开」（命令 74 → 78）。
            不加 `#[cfg]` —— 命令名就是契约面，手机端同名注册、内部回 IO_ERROR。 */
            commands::data_root_cmd::data_root_get,
            commands::data_root_cmd::data_root_change,
            commands::data_root_cmd::data_root_open,
            commands::md_sync_cmd::md_backup_open,
            // [V0.12.0] 手机端原生能力（SAF 目录 / 悬浮条）；桌面侧四条是桩
            commands::mobile_cmd::md_saf_pick,
            commands::mobile_cmd::md_saf_status,
            commands::mobile_cmd::overlay_set,
            commands::mobile_cmd::overlay_status,
            // [V0.5.0] 迁移可见性（命令 65 → 67，见 ADR-037）
            commands::migration_cmd::get_migration_info,
            commands::migration_cmd::open_legacy_dir,
        ]);

    // K-5：拦截关闭请求 -> 隐藏窗口。移动端没有「关窗即隐藏」的语义（返回键退后台由
    // 系统管），且 `WindowEvent` 的关窗分支在 Android 上没有触发点，故只在桌面挂。
    #[cfg(desktop)]
    let builder = builder.on_window_event(infra::window::on_window_event);

    builder.run(ctx).expect("Timing 启动失败");
}
