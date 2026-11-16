use crate::app::activity::desktop_behavior;
use crate::app::activity::main_window;
use crate::app::activity::runtime_tasks;
use crate::app::activity::tray::setup_tray;
use crate::models::activity::settings::{DesktopBehaviorSettings, StartupSource};
use crate::services::activity::engine::tracking::watchdog::RuntimeHealthState;
use crate::infra::activity::windows::{audio, media, power};
#[cfg(any(test, all(not(debug_assertions), not(feature = "activity_local_build"))))]
use std::path::Path;
use std::sync::Arc;

pub const AUTOSTART_ARG: &str = "--autostart";

#[derive(Clone, Copy, Debug)]
pub(crate) struct StartupContext {
    pub(crate) settings: DesktopBehaviorSettings,
    pub(crate) source: StartupSource,
}

impl StartupContext {
    pub(crate) fn new(settings: DesktopBehaviorSettings, source: StartupSource) -> Self {
        Self { settings, source }
    }
}

pub fn was_launched_by_autostart() -> bool {
    std::env::args().any(|arg| arg == AUTOSTART_ARG)
}

#[cfg(any(test, all(not(debug_assertions), not(feature = "activity_local_build"))))]
#[cfg_attr(debug_assertions, allow(dead_code))]
pub fn should_use_local_build_context() -> bool {
    match std::env::current_exe() {
        Ok(path) => is_workspace_target_binary(&path),
        Err(_) => false,
    }
}

#[cfg(any(test, all(not(debug_assertions), not(feature = "activity_local_build"))))]
fn is_workspace_target_binary(path: &Path) -> bool {
    let components = path
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .map(|component| component.to_ascii_lowercase())
        .collect::<Vec<_>>();

    components.windows(3).any(|window| {
        window == ["src-tauri", "target", "release"] || window == ["src-tauri", "target", "debug"]
    })
}

pub(crate) fn now_ms() -> u64 {
    crate::infra::activity::clock::unix_timestamp_millis_u64()
}

pub fn setup(
    app: &mut tauri::App,
    runtime_health: Arc<RuntimeHealthState>,
    startup: StartupContext,
) -> tauri::Result<()> {
    tauri::async_runtime::block_on(crate::app::activity::remote_status_bridge::ensure_machine_id(
        &app.handle().clone(),
    ))
    .map_err(std::io::Error::other)?;
    crate::app::activity::tracking::register_power_lifecycle_handler(app);
    crate::app::activity::mini_window::register_power_handler(app);
    use tauri::Manager;
    if let (true, Ok(paths)) = (
        crate::infra::activity::runtime_diagnostics::enabled_for_process(),
        crate::infra::activity::storage_paths::resolve_storage_paths(app.handle()),
    ) {
        let health = runtime_health.clone();
        if let Ok(observer) = crate::infra::activity::runtime_diagnostics::RuntimeDiagnostics::start(
            paths.data_root.join("diagnostics"),
            move || {
                let progress = health.progress.snapshot();
                let stalled = progress.stalled;
                (
                    stalled,
                    serde_json::json!({
                        "utc_ms": crate::infra::activity::clock::unix_timestamp_millis_i64(),
                        "pid": std::process::id(), "tracking": progress,
                        "probes": crate::infra::activity::windows::native_probe::diagnostics(),
                        "names": crate::services::activity::engine::tracking::app_names::diagnostics(),
                        "database": crate::services::activity::data::sqlite_pool::diagnostics::snapshot(),
                    }),
                )
            },
        ) {
            app.manage(observer);
        }
    }
    crate::app::activity::tools::register_alert_handler(app);
    power::start(app.handle().clone());
    let pause = app.state::<crate::services::activity::engine::tracking::pause_state::TrackingPauseRuntimeState>();
    audio::start_signal_source(pause.subscribe());
    media::start_signal_source(pause.subscribe());
    crate::app::activity::web_activity_bridge::start(app.handle().clone());
    crate::app::activity::remote_status_bridge::start(app.handle().clone());
    crate::services::activity::data::activity_read_model::spawn_background_worker(app.handle().clone());

    let app_handle = app.handle().clone();
    main_window::ensure_main_window(&app_handle).map_err(std::io::Error::other)?;
    app_handle
        .state::<crate::app::activity::state::DesktopBehaviorState>()
        .replace(startup.settings);
    if startup.settings.startup_ui_strategy(startup.source)
        != crate::models::activity::settings::StartupUiStrategy::Show
    {
        app_handle
            .state::<crate::app::activity::state::BackgroundEntryState>()
            .begin_startup();
    }
    /* [Timing 融合 D5] `setup_tray` 现在**不创建任何图标**：同一进程里两个托盘等于
    「两个应用」，配置项也重复。是否创建由 `tray::PATINA_OWN_TRAY` 一处开关决定，
    保持调用点不变只是为了将来恢复独立托盘时不用改这层编排。
    入口改由宿主托盘「时间统计…」与设置页「通用 → 时间统计」提供，见
    `infra::tray_menu::ID_OPEN_STATS` 与 `commands::window_cmd::open_activity_window`。 */
    setup_tray(&app_handle)?;
    if !desktop_behavior::apply_startup_desktop_behavior(
        &app_handle,
        startup.settings,
        startup.source,
    ) {
        return Err(std::io::Error::other("failed to establish startup UI recovery path").into());
    }
    /* [Timing 融合] **没有更新自检**：Patina 上游的更新端点指向
    `github.com/Ceceliaee/patina`（别人的仓库），那条链连同启动自检、命令、前端入口
    已整批删除（O3，2026-11-16，判据 `tests/update_channel_removed.rs`）。发版统一走
    Timing 自己的签名安装包，前端没有任何「检查更新」入口可以点到。 */
    runtime_tasks::spawn_tracking_runtime_restart_loop(
        app.handle().clone(),
        runtime_health.clone(),
    );
    runtime_tasks::spawn_tracking_watchdog_restart_loop(app.handle().clone(), runtime_health);
    runtime_tasks::spawn_scheduled_backup_runtime_restart_loop(app.handle().clone());
    runtime_tasks::spawn_scheduled_export_runtime_restart_loop(app.handle().clone());

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_workspace_target_binary;
    use std::path::Path;

    #[test]
    fn detects_workspace_target_binary_on_windows_path() {
        assert!(is_workspace_target_binary(Path::new(
            r"src-tauri\target\release\patina.exe"
        )));
    }

    #[test]
    fn detects_workspace_target_binary_on_unix_path() {
        assert!(is_workspace_target_binary(Path::new(
            "src-tauri/target/debug/patina"
        )));
    }

    #[test]
    fn ignores_installed_binary_path() {
        assert!(!is_workspace_target_binary(Path::new(
            r"AppData\Local\Patina\patina.exe"
        )));
    }
}
