use std::sync::Arc;

use crate::patina::app::{
    runtime,
    state::{
        AppExitState, AppSettingsCommitState, BackgroundEntryState, DesktopBehaviorState,
        MainWindowLifecycleState,
    },
    tray,
};
use crate::patina::domain::lifecycle::AppRestartState;
use crate::patina::domain::settings::{DesktopBehaviorSettings, StartupSource};
use crate::patina::engine::{
    tools::{ToolsRuntimeState, ToolsRuntimeWakeState},
    tracking::{
        pause_state::TrackingPauseRuntimeState, runtime_snapshot::TrackingRuntimeSnapshotState,
        title_state::TitleRecordingRuntimeState, watchdog::RuntimeHealthState,
    },
    updater::UpdaterRuntimeState,
    web_activity::WebActivityRuntimeState,
};
use crate::patina::data;
use tauri::Manager;

pub struct BootstrapInput {
    pub app_version: String,
}

/// 把 Patina 的状态与插件挂到**宿主**的 `Builder` 上。
///
/// 与上游 `build()` 的差别（都是「一个进程只有一个 Tauri App」的硬约束导致）：
/// - 不建 `Builder`，接收宿主已经建好的那个；
/// - 不注册 single-instance / autostart / notification —— 宿主 Timing 已注册同类插件，
///   重复注册会 panic 或双份自启项；
/// - 不挂 `setup` / `on_window_event` —— Tauri 各只允许一个，由宿主统一编排后调用
///   ［`setup`］与 [`on_window_event`］。
pub fn configure(builder: tauri::Builder<tauri::Wry>, input: BootstrapInput) -> tauri::Builder<tauri::Wry> {
    let runtime_health = Arc::new(RuntimeHealthState::default());
    register_managed_state_and_plugins(builder, &input.app_version, runtime_health)
}

fn register_managed_state_and_plugins(
    builder: tauri::Builder<tauri::Wry>,
    app_version: &str,
    runtime_health: Arc<RuntimeHealthState>,
) -> tauri::Builder<tauri::Wry> {
    builder
        .manage(DesktopBehaviorState::default())
        .manage(AppSettingsCommitState::default())
        .manage(AppExitState::default())
        .manage(BackgroundEntryState::default())
        .manage(AppRestartState::default())
        .manage(MainWindowLifecycleState::default())
        .manage(crate::patina::app::main_window::tools_navigation::ToolsNavigationState::default())
        .manage(crate::patina::app::webview_recovery::WebviewRecoveryState::default())
        .manage(crate::patina::app::mini_window::MiniWindowState::default())
        .manage(TrackingRuntimeSnapshotState::default())
        .manage(TrackingPauseRuntimeState::default())
        .manage(TitleRecordingRuntimeState::default())
        .manage(crate::patina::domain::localization::LocalizationState::default())
        .manage(tray::TrayMenuRebuildState::default())
        .manage(tray::TrayIconRuntimeState::default())
        .manage(runtime_health)
        .manage(ToolsRuntimeState::default())
        .manage(crate::patina::app::tool_notifications::State::default())
        .manage(ToolsRuntimeWakeState::default())
        .manage(crate::patina::platform::web_activity_bridge::WebActivityBridgeRuntimeState::default())
        .manage(crate::patina::engine::remote_status_bridge::RemoteStatusBridgeRuntimeState::default())
        .manage(WebActivityRuntimeState::default())
        .manage(UpdaterRuntimeState::new(app_version.to_string()))
        .manage(crate::patina::app::scheduled_backup::ScheduledBackupRuntimeState::default())
        .manage(crate::patina::app::scheduled_export::ScheduledExportRuntimeState::default())
        /* autostart / notification 由宿主注册（同一个进程只能有一份）：见 `configure` 的说明。 */
        .manage(crate::patina::data::sqlite_pool::AppSqlitePool::default())
        .manage(crate::patina::data::activity_read_model::ReadModelWake::default())
        .plugin(tauri_plugin_opener::init())
        /* 上游还注册了 `tauri-plugin-updater`，但它要求 `tauri.conf.json` 的
        `plugins.updater` 是一份完整配置（pubkey + endpoints），而 Timing 一直没有自动
        更新器（发版靠 `release/` 里的签名 NSIS 包手动分发）——配置为 null 时插件初始化
        直接 panic，整个应用起不来。
        取舍：**先不注册**。Patina 的「检查更新」入口仍在（`engine::updater`），运行时
        会拿不到 plugin 而回错误，属于「功能未启用」而不是崩溃。
        等 Timing 决定做自动更新时，补 `plugins.updater` 配置并把这一行加回来。 */
}

/* Patina 的命令表**不在这里**：Tauri 的 `invoke_handler` 只能设一次，而 `Invoke` 不可克隆，
两张表拼不成闭包。命令清单已并入宿主的应用级命令表 `crate::ipc_commands`
（`#[cfg(desktop)]` 那一段），这也让它们继续受 `permissions/window-commands.toml` 管辖。 */

/// 宿主 `setup` 钩子里调用（Tauri 只允许一个 setup，由宿主编排后进这里）。
///
/// `launched_by_autostart` 由宿主判定后传入。
pub fn setup(
    app: &mut tauri::App,
    launched_by_autostart: bool,
) -> Result<(), Box<dyn std::error::Error>> {
    let runtime_health = app.state::<Arc<RuntimeHealthState>>().inner().clone();
    {
            crate::patina::platform::storage_control::initialize(app.handle()).map_err(storage_startup_error)?;
            let handled_storage_restart = tauri::async_runtime::block_on(
                data::storage_migration::run_pending_storage_migration(app.handle()),
            )
            .map_err(storage_startup_error)?;
            crate::patina::platform::storage_paths::resolve_storage_paths(app.handle()).map_err(storage_startup_error)?;
            tauri::async_runtime::block_on(data::sqlite_pool::initialize_app_sqlite(app.handle()))
                .map_err(std::io::Error::other)?;
            // Resolve interrupted credential saves before backup schedulers start.
            if let Err(error) = tauri::async_runtime::block_on(data::remote_backup_config::snapshot(app.handle())) {
                eprintln!("[backup] credential recovery unavailable: {error}");
            }
            tauri::async_runtime::block_on(data::app_settings_service::migrate_legacy_web_links(app.handle()))
                .map_err(std::io::Error::other)?;
            let mut should_clear_update_reopen_intent = false;
            let startup = match tauri::async_runtime::block_on(
                data::app_settings_service::load_desktop_behavior_startup_state(app.handle()),
            ) {
                Ok(startup_state) => {
                    should_clear_update_reopen_intent =
                        startup_state.should_reopen_main_window;
                    runtime::StartupContext::new(
                        startup_state.settings,
                        resolve_startup_source(
                            launched_by_autostart,
                            handled_storage_restart,
                            startup_state.should_reopen_main_window,
                        ),
                    )
                }
                Err(error) => {
                    eprintln!(
                        "[startup] failed to load desktop behavior settings; showing main window: {error}"
                    );
                    runtime::StartupContext::new(
                        DesktopBehaviorSettings::default(),
                        StartupSource::SettingsRecovery,
                    )
                }
            };
            runtime::setup(app, runtime_health.clone(), startup)?;
            if should_clear_update_reopen_intent {
                if let Err(error) = tauri::async_runtime::block_on(
                    data::app_settings_service::clear_post_install_reopen_main_window(app.handle()),
                ) {
                    eprintln!(
                        "[startup] main window reopened but update intent could not be cleared: {error}"
                    );
                }
            }
            Ok(())
    }
}

/// 宿主 `on_window_event` 里转发：同一个窗口事件链只能挂一个监听。
pub fn on_window_event(window: &tauri::Window, event: &tauri::WindowEvent) {
    tray::handle_window_event(window, event);
}

fn resolve_startup_source(
    launched_by_autostart: bool,
    handled_storage_restart: bool,
    should_reopen_after_update: bool,
) -> StartupSource {
    if handled_storage_restart {
        StartupSource::StorageRestart
    } else if should_reopen_after_update {
        StartupSource::UpdateRestart
    } else if launched_by_autostart {
        StartupSource::Autostart
    } else {
        StartupSource::Manual
    }
}

pub(crate) fn handle_run_event(app: &tauri::AppHandle, event: tauri::RunEvent) {
    match event {
        tauri::RunEvent::ExitRequested { code, api, .. } => {
            let exit_requested = app.state::<AppExitState>().is_exit_requested();
            let keep_running = should_keep_app_running_without_windows(
                code.is_some(),
                app.state::<DesktopBehaviorState>()
                    .snapshot()
                    .should_keep_running_in_background(),
                app.state::<BackgroundEntryState>().keeps_running(),
                exit_requested,
            );

            if keep_running {
                api.prevent_exit();
            }
        }
        tauri::RunEvent::Exit => {
            tray::stop_taskbar_theme_watcher(app);
            if let Some(observer) =
                app.try_state::<crate::patina::platform::runtime_diagnostics::RuntimeDiagnostics>()
            {
                observer.stop();
            }
            crate::patina::platform::windows::native_probe::shutdown();
            #[cfg(feature = "patina_coverage")]
            crate::patina::flush_coverage();
        }
        _ => {}
    }
}

/// 「没有窗口了也别退」的两个来源：设置里开了托盘常驻（用户明确要的）、
/// 或托盘兜底逻辑强制常驻（安全网）。两者都要被「真的要走」一票否决。
///
/// `explicit_exit` 来自 `RunEvent::ExitRequested { code }`：`Some` = 有人调了
/// `app.exit(code)`。**上游只看自己的 `AppExitState`，融合后会吃掉宿主的退出**：
/// Timing 的「托盘退出」与 `quit_app` 命令都不会写那个状态，于是 `prevent_exit()`
/// 把退出拦下 —— 窗口已销毁、进程还在，md 同步继续每分钟唤醒，实测点了退出后
/// 又跑了 12 分钟才被外部终止（退出码 1）。`code` 是 Tauri 自己给的、不依赖谁记得
/// 去写一个标志位，比补标志位更难再次退化。
fn should_keep_app_running_without_windows(
    explicit_exit: bool,
    configured_tray_residency: bool,
    safety_tray_forced: bool,
    exit_requested: bool,
) -> bool {
    !explicit_exit && !exit_requested && (configured_tray_residency || safety_tray_forced)
}

#[cfg(test)]
mod tests {
    use super::{resolve_startup_source, should_keep_app_running_without_windows};
    use crate::patina::domain::settings::StartupSource;

    #[test]
    fn ordinary_launch_sources_are_distinguished() {
        assert_eq!(
            resolve_startup_source(false, false, false),
            StartupSource::Manual
        );
        assert_eq!(
            resolve_startup_source(true, false, false),
            StartupSource::Autostart
        );
    }

    #[test]
    fn explicit_restarts_override_autostart_arguments() {
        assert_eq!(
            resolve_startup_source(true, false, true),
            StartupSource::UpdateRestart
        );
        assert_eq!(
            resolve_startup_source(true, true, true),
            StartupSource::StorageRestart
        );
        assert_eq!(
            resolve_startup_source(false, true, false),
            StartupSource::StorageRestart
        );
    }

    #[test]
    fn forced_startup_tray_keeps_close_to_exit_apps_running() {
        /* 参数顺序：显式退出 / 设置常驻 / 安全网强制 / 自己的退出标志 */
        assert!(should_keep_app_running_without_windows(
            false, false, true, false
        ));
        assert!(should_keep_app_running_without_windows(
            false, true, false, false
        ));
        assert!(!should_keep_app_running_without_windows(
            false, false, false, false
        ));
        assert!(!should_keep_app_running_without_windows(
            false, true, true, true
        ));
    }

    /// 「有人调了 `app.exit(0)`」一票否决，且**与常驻设置无关**。
    ///
    /// 这条是融合后补的回归点：上游只看自己的 `AppExitState`，而宿主的退出路径
    /// （`app::tray_quit`、`commands::system_cmd::quit_app`）不写它，
    /// `prevent_exit()` 就把退出吃掉 —— 表现为「点了退出，托盘图标没了，进程还在
    /// 每分钟跑一次 md 同步」。写成纯函数参数是为了让 `code.is_some()`
    /// 这一句本身可被钉住：只钉「函数被调用」挡不住实参传错。
    #[test]
    fn explicit_exit_is_never_prevented() {
        assert!(!should_keep_app_running_without_windows(
            true, true, true, false
        ));
        assert!(!should_keep_app_running_without_windows(
            true, true, true, true
        ));
    }
}

fn storage_startup_error(error: String) -> std::io::Error {
    use crate::patina::domain::localization::{format_text, Locale};
    let message = format_text(
        Locale::default(),
        "native.storage.startupFailure",
        &[("details", error.clone())],
    );
    rfd::MessageDialog::new()
        .set_title("Patina")
        .set_description(message)
        .set_level(rfd::MessageLevel::Error)
        .show();
    std::io::Error::other(error)
}
