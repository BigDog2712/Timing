use crate::app::insight::state::{
    AppExitState, MainWindowLifecycleSnapshot, MainWindowLifecycleState, MainWindowReadyDecision,
    MainWindowRenderToken, MainWindowShowDecision, MainWindowTimeoutDecision,
};
use crate::models::insight::settings::StartupSource;
use crate::infra::insight::storage_paths;
use crate::infra::insight::windows::window_activation;
use std::time::{Duration, Instant};
use tauri::{
    webview::PageLoadEvent, AppHandle, Manager, Runtime, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder, Window,
};

mod recovery;
pub(crate) mod tools_navigation;

pub(crate) const MAIN_WINDOW_LABEL: &str = "patina";

pub(crate) async fn show_desktop() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(crate::infra::insight::windows::desktop::show_desktop)
        .await
        .map_err(|error| error.to_string())?
}

const MAIN_WINDOW_TITLE: &str = "Timing";
const MAIN_WINDOW_WIDTH: f64 = 1100.0;
const MAIN_WINDOW_HEIGHT: f64 = 736.0;
const MAIN_WINDOW_MIN_WIDTH: f64 = 900.0;
const MAIN_WINDOW_MIN_HEIGHT: f64 = 636.0;
const MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS: u64 = 30;
/* 上游取 8 秒。融合后有两处让它不够用：
1. **开发模式**：宿主是双入口 + 437 个 Patina 模块走 Vite 逐模块加载（不是打包产物），
   首帧经常超过 8 秒 → `ready-timeout` → 窗口被判「无响应」重建，用户看到的是一次闪现；
2. 冷启动（首次建库 + 首启导入）本来就更慢。
放宽到 60 秒：帧没画出来时窗口本来就不可见，等久一点只是「晚出现」，不会让人看到白屏。 */
const MAIN_WINDOW_READY_TIMEOUT_SECS: u64 = 60;
const MAIN_WINDOW_LIVENESS_TIMEOUT_MILLIS: u64 = 1_500;
const MAIN_WINDOW_GENERATION_PROPERTY: &str = "__PATINA_MAIN_WINDOW_GENERATION__";
const MAIN_WINDOW_LIVENESS_CALLBACK: &str = "__PATINA_MAIN_WINDOW_LIVENESS_REQUEST__";

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowShowReason {
    Startup(StartupSource),
    StartupRecovery,
    TrayMenu,
    TrayIcon,
    Mini,
    #[cfg(desktop)]
    SingleInstance,
    ToolAlert,
    DestroyRecovery,
}

impl MainWindowShowReason {
    fn as_str(self) -> &'static str {
        match self {
            Self::Startup(source) => source.as_str(),
            Self::StartupRecovery => "startup-recovery",
            Self::TrayMenu => "tray-menu",
            Self::TrayIcon => "tray-icon",
            Self::Mini => "mini",
            #[cfg(desktop)]
            Self::SingleInstance => "single-instance",
            Self::ToolAlert => "tool-alert",
            Self::DestroyRecovery => "destroy-recovery",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum MainWindowReadyOutcome {
    Stale,
    Duplicate,
    Hidden,
    Revealed,
}

impl MainWindowReadyOutcome {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Stale => "stale",
            Self::Duplicate => "duplicate",
            Self::Hidden => "hidden",
            Self::Revealed => "revealed",
        }
    }
}

fn log_main_window_event(
    event: &str,
    snapshot: MainWindowLifecycleSnapshot,
    reason: &str,
    result: &str,
) {
    crate::log_info!(
        "event={event} generation={} load_epoch={} reason={reason} desired_visible={} render_state={} create_in_progress={} destroy_in_progress={} reveal_in_progress={} elapsed_ms={} result={result}",
        snapshot.generation,
        snapshot.load_epoch,
        snapshot.desired_visible,
        snapshot.render_state.as_str(),
        snapshot.create_in_progress,
        snapshot.destroy_in_progress,
        snapshot.reveal_in_progress,
        snapshot.elapsed_ms.unwrap_or(0),
    );
}

pub(crate) fn show_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    reason: MainWindowShowReason,
) -> bool {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let decision = lifecycle.request_show();
    log_main_window_event(
        "show-requested",
        lifecycle.snapshot(),
        reason.as_str(),
        match decision {
            MainWindowShowDecision::Wait => "waiting-for-ready",
            MainWindowShowDecision::Reveal { .. } => "reveal-claimed",
            MainWindowShowDecision::Probe { .. } => "liveness-probe-claimed",
            MainWindowShowDecision::Recreate => "recreate-after-timeout",
            MainWindowShowDecision::Destroying => "queued-during-destroy",
        },
    );

    if decision == MainWindowShowDecision::Destroying {
        return true;
    }

    if decision == MainWindowShowDecision::Recreate {
        return recreate_main_window(app, "ready-timeout").is_ok();
    }

    let ensure_result = match ensure_main_window_once(app) {
        Ok(result) => result,
        Err(error) => {
            crate::log_error!("failed to ensure main window: {error}");
            if let MainWindowShowDecision::Reveal { token } = decision {
                lifecycle.finish_reveal(token, false);
            }
            return false;
        }
    };

    match (ensure_result, decision) {
        (MainWindowEnsureResult::Existing(window), MainWindowShowDecision::Reveal { token }) => {
            reveal_main_window(app, &window, token, reason.as_str()).is_ok()
        }
        (MainWindowEnsureResult::Existing(window), MainWindowShowDecision::Probe { token }) => {
            probe_main_window_liveness(app, &window, token, reason.as_str()).is_ok()
        }
        (MainWindowEnsureResult::Existing(_), MainWindowShowDecision::Wait)
        | (MainWindowEnsureResult::Created(_), _)
        | (MainWindowEnsureResult::Creating, _) => true,
        (_, MainWindowShowDecision::Recreate) => true,
        (_, MainWindowShowDecision::Destroying) => true,
    }
}

fn probe_main_window_liveness<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    token: MainWindowRenderToken,
    reason: &str,
) -> Result<(), String> {
    let script = format!("window.{MAIN_WINDOW_LIVENESS_CALLBACK}?.();");
    if let Err(error) = window.eval(&script) {
        log_main_window_event(
            "liveness-probe-failed",
            app.state::<MainWindowLifecycleState>().snapshot(),
            reason,
            "eval-error-recreate",
        );
        recreate_main_window(app, "liveness-eval-error")?;
        return Err(format!("failed to probe hidden main window: {error}"));
    }

    log_main_window_event(
        "liveness-probe-started",
        app.state::<MainWindowLifecycleState>().snapshot(),
        reason,
        "waiting-for-frontend",
    );
    schedule_main_window_liveness_timeout(app.clone(), token);
    Ok(())
}

pub(crate) fn mark_main_window_ready<R: Runtime + 'static>(
    app: &AppHandle<R>,
    token: MainWindowRenderToken,
) -> Result<MainWindowReadyOutcome, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let decision = lifecycle.mark_ready(token);
    let (ready_result, result) = match decision {
        MainWindowReadyDecision::Stale => ("stale", MainWindowReadyOutcome::Stale),
        MainWindowReadyDecision::Duplicate => ("duplicate", MainWindowReadyOutcome::Duplicate),
        MainWindowReadyDecision::Hidden => ("accepted-hidden", MainWindowReadyOutcome::Hidden),
        MainWindowReadyDecision::Reveal { token } => {
            log_main_window_event(
                "frontend-ready",
                lifecycle.snapshot(),
                "frontend",
                "accepted-reveal",
            );
            let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
                lifecycle.finish_reveal(token, false);
                return Err("main window disappeared before ready reveal".to_string());
            };
            return if reveal_main_window(app, &window, token, "frontend-ready")? {
                Ok(MainWindowReadyOutcome::Revealed)
            } else {
                Ok(MainWindowReadyOutcome::Hidden)
            };
        }
    };
    log_main_window_event(
        "frontend-ready",
        lifecycle.snapshot(),
        "frontend",
        ready_result,
    );
    Ok(result)
}

pub(crate) fn current_main_window_render_token<R: Runtime>(
    app: &AppHandle<R>,
) -> Option<MainWindowRenderToken> {
    app.state::<MainWindowLifecycleState>()
        .current_render_token()
}

pub(crate) fn destroy_hidden_main_window_for_e2e<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    if !cfg!(debug_assertions) || std::env::var("PATINA_E2E").as_deref() != Ok("1") {
        return Err("main-window destruction is available only to the isolated E2E runtime".into());
    }

    let window = app
        .get_webview_window(MAIN_WINDOW_LABEL)
        .ok_or_else(|| "main window is unavailable".to_string())?;
    if window.is_visible().unwrap_or(false) {
        return Err("refusing to destroy a visible main window".to_string());
    }

    crate::log_info!("event=e2e-destroy-requested result=accepted");
    let result = window
        .destroy()
        .map_err(|error| format!("failed to destroy hidden E2E main window: {error}"));
    crate::log_info!(
        "event=e2e-destroy-finished result={}",
        if result.is_ok() { "success" } else { "error" }
    );
    result
}

fn reveal_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &WebviewWindow<R>,
    token: MainWindowRenderToken,
    reason: &str,
) -> Result<bool, String> {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.can_reveal(token) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-suppressed",
            lifecycle.snapshot(),
            reason,
            "state-changed-before-show",
        );
        return Ok(false);
    }

    if let Err(error) = window.show() {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "window-show-error",
        );
        crate::log_error!("failed to show main window: {error}");
        recreate_main_window(app, "window-show-error")?;
        return Ok(false);
    }

    let _ = window.unminimize();
    // Win+D can leave the HWND outside Tauri's normal minimized/visible path.
    if let Err(error) = window_activation::restore_to_foreground(window) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "native-restore-error",
        );
        crate::log_error!("failed to restore native foreground window: {error}");
        recreate_main_window(app, "native-restore-error")?;
        return Ok(false);
    }
    let _ = window.set_focus();

    if window_activation::is_native_window_visible(window) != Ok(true) {
        lifecycle.finish_reveal(token, false);
        log_main_window_event(
            "show-failed",
            lifecycle.snapshot(),
            reason,
            "native-window-not-visible",
        );
        recreate_main_window(app, "native-window-not-visible")?;
        return Ok(false);
    }

    if lifecycle.finish_reveal(token, true) {
        let _ = window.hide();
        log_main_window_event(
            "show-suppressed",
            lifecycle.snapshot(),
            reason,
            "hidden-race-won",
        );
        return Ok(false);
    }

    crate::app::insight::tray::on_main_window_revealed(app);
    log_main_window_event("show-succeeded", lifecycle.snapshot(), reason, "visible");
    Ok(true)
}

pub(crate) async fn minimize_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<(), String> {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        return Err("main window is unavailable".to_string());
    };

    window
        .minimize()
        .map_err(|error| format!("failed to minimize main window: {error}"))
}

pub(crate) fn hide_main_window_for_background<R: Runtime + 'static>(
    app: &AppHandle<R>,
    window: &Window<R>,
) {
    let hide_generation = app.state::<MainWindowLifecycleState>().hide();
    let _ = window.hide();

    schedule_main_window_destroy_after_background(app.clone(), hide_generation);
}

/// 认领「本次启动走隐藏」：把生命周期状态推进到「已隐藏」，并安排后台销毁以释放内存。
///
/// 返回 `false` 时**必须**有出因：融合后排查「为什么窗口一启动就自己冒出来」时，
/// 上游那句 `registration was rejected` 只是症状复述 —— 到底是窗口不在、还是状态机
/// 不认（`desired_visible` 已被置真），两种成因的修法完全不同。
/// 「窗口已经可见」不再是出因：见函数体内的说明。
pub(crate) fn register_hidden_main_window_startup<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> bool {
    let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
        crate::log_warn!("hidden registration rejected: window-missing");
        return false;
    };

    /* 这里**不能**因为「窗口已经可见」就放弃认领。
    实测：`WebviewWindowBuilder::visible(false)` 建出来的窗口，在这个时点
    `is_visible()` 仍返回 `true`（建窗与页面的可见性不是同一件事）。上游据此放弃，
    回落到「显示主窗口」——于是每次启动都会弹一个空的 Patina 窗口。
    宿主 Timing 是起在托盘里的，那等于把它的启动观感改掉了。
    融合口径：**认领隐藏就把窗口藏起来**，而不是要求「它本来就没显示」。 */
    let _ = window.hide();

    let Some(hide_generation) = app
        .state::<MainWindowLifecycleState>()
        .try_hide_for_startup()
    else {
        let snapshot = app.state::<MainWindowLifecycleState>().snapshot();
        crate::log_warn!(
            "hidden registration rejected: lifecycle-desired-visible desired_visible={} generation={}",
            snapshot.desired_visible, snapshot.generation
        );
        return false;
    };

    schedule_main_window_destroy_after_background(app.clone(), hide_generation);

    true
}

pub(crate) fn ensure_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<WebviewWindow<R>, String> {
    match ensure_main_window_once(app)? {
        MainWindowEnsureResult::Existing(window) | MainWindowEnsureResult::Created(window) => {
            Ok(window)
        }
        MainWindowEnsureResult::Creating => {
            Err("main window creation is already in progress".to_string())
        }
    }
}

enum MainWindowEnsureResult<R: Runtime> {
    Existing(WebviewWindow<R>),
    Created(WebviewWindow<R>),
    Creating,
}

fn ensure_main_window_once<R: Runtime + 'static>(
    app: &AppHandle<R>,
) -> Result<MainWindowEnsureResult<R>, String> {
    if let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) {
        if window_activation::is_native_window_alive(&window) == Ok(true) {
            return Ok(MainWindowEnsureResult::Existing(window));
        }

        crate::log_warn!("stale Tauri window found without a live native HWND; recreating");
        recreate_main_window(app, "stale-native-window")?;
        return Ok(MainWindowEnsureResult::Creating);
    }

    /* [0.12.1 修复] 这里**不能**再钉 `data_directory(webview_root)`。
     *
     * 事故：`tauri.conf.json` 静态创建的 main 用 Tauri 默认 WebView 数据目录，而本函数
     * （闲置销毁后的重建路径）用 `webview_root`。**localStorage 按数据目录分区**，所以窗口
     * 被销毁重建一次，悬浮条的手柄绑定与药丸外观就整份换成另一套 —— 用户看到「设置自己变了」，
     * 且零日志。更要命的是它与「设置页写了药丸读不到」是同一个根因的两种表现
     * （`lib/pillAppearance.ts::PILL_PREFS_EVENT` 有完整说明）。
     *
     * 建窗目录只留一处口径 = Tauri 默认（与 conf 完全一致）。patina / mini / tool-notification
     * 仍各自钉 `webview_root`：它们要的是 Patina 自己的 profile，与 main 无关，也不能并过来。
     *
     * 保留这次 resolve 调用：自定义数据根不可用时它要提前报错，与"建在哪"无关。 */
    let _ = storage_paths::resolve_storage_paths(app)?;
    let lifecycle = app.state::<MainWindowLifecycleState>();
    let Some(generation) = lifecycle.begin_window_creation() else {
        return Ok(MainWindowEnsureResult::Creating);
    };
    let created_at = Instant::now();
    log_main_window_event(
        "creation-started",
        lifecycle.snapshot(),
        "window-missing",
        "hidden",
    );
    let initialization_script = main_window_initialization_script(generation);

    let builder = WebviewWindowBuilder::new(app, MAIN_WINDOW_LABEL, main_window_url())
        .title(MAIN_WINDOW_TITLE)
        .inner_size(MAIN_WINDOW_WIDTH, MAIN_WINDOW_HEIGHT)
        .min_inner_size(MAIN_WINDOW_MIN_WIDTH, MAIN_WINDOW_MIN_HEIGHT)
        .resizable(true)
        .decorations(false)
        .transparent(true)
        .center()
        /* 建窗时不可见：窗口由前端 `cmd_mark_main_window_ready` 握手后才揭示，
        避免「白底闪一下再变透明」。 */
        .visible(false)
        .initialization_script(initialization_script)
        .on_page_load(move |window, payload| {
            match payload.event() {
                PageLoadEvent::Started => {
                    let app = window.app_handle();
                    let lifecycle = app.state::<MainWindowLifecycleState>();
                    let Some(token) = lifecycle.begin_page_load(generation) else {
                        log_main_window_event(
                            "page-load-started",
                            lifecycle.snapshot(),
                            "webview",
                            "stale",
                        );
                        return;
                    };

                    let _ = window.hide();
                    log_main_window_event(
                        "page-load-started",
                        lifecycle.snapshot(),
                        payload.url().scheme(),
                        "hidden-until-ready",
                    );
                    schedule_main_window_ready_timeout(app.clone(), token);
                }
                PageLoadEvent::Finished => {
                    crate::log_info!(
                        "event=page-load-finished generation={generation} elapsed_ms={} url_scheme={} result=observed",
                        created_at.elapsed().as_millis(),
                        payload.url().scheme(),
                    );
                }
            }
        });

    #[cfg(debug_assertions)]
    let builder = if std::env::var("PATINA_E2E").as_deref() == Ok("1") {
        let devtools_port = std::env::var("PATINA_E2E_DEVTOOLS_PORT")
            .expect("PATINA_E2E_DEVTOOLS_PORT is required when PATINA_E2E=1")
            .parse::<u16>()
            .expect("PATINA_E2E_DEVTOOLS_PORT must be a valid TCP port");
        builder.additional_browser_args(&format!(
            "--remote-debugging-port={devtools_port} \
             --disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection"
        ))
    } else {
        builder
    };

    match builder.build() {
        Ok(window) => {
            let reveal_token = lifecycle.finish_window_creation(generation, true);
            super::webview_recovery::observe(
                &window,
                super::webview_recovery::WindowKind::Main,
                generation,
            );
            log_main_window_event("created", lifecycle.snapshot(), "builder", "hidden");
            if let Some(token) = lifecycle.current_render_token() {
                schedule_main_window_ready_timeout(app.clone(), token);
            }
            if let Some(token) = reveal_token {
                reveal_main_window(app, &window, token, "frontend-ready-during-create")?;
            }
            Ok(MainWindowEnsureResult::Created(window))
        }
        Err(error) => {
            lifecycle.finish_window_creation(generation, false);
            log_main_window_event("creation-failed", lifecycle.snapshot(), "builder", "error");
            Err(format!("failed to create main window: {error}"))
        }
    }
}

pub(crate) async fn stop_failed_webview<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
) -> Result<(), String> {
    recovery::remove(app, generation, "webview-recovery-exhausted")
        .await
        .map(|_| ())
}

pub(crate) async fn recover_failed_webview<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
) -> Result<(), String> {
    let snapshot = app.state::<MainWindowLifecycleState>().snapshot();
    if snapshot.generation != generation || app.state::<AppExitState>().is_exit_requested() {
        return Ok(());
    }
    recovery::rebuild(app, generation, "webview-process-failed").await
}

fn recreate_main_window<R: Runtime + 'static>(
    app: &AppHandle<R>,
    reason: &str,
) -> Result<(), String> {
    let generation = app
        .state::<MainWindowLifecycleState>()
        .snapshot()
        .generation;
    let app = app.clone();
    let reason = reason.to_owned();
    tauri::async_runtime::spawn(async move {
        if let Err(error) = recovery::rebuild(&app, generation, &reason).await {
            crate::log_error!("recovery failed: {error}");
        }
    });
    Ok(())
}

pub(crate) fn handle_unexpected_main_window_destroyed<R: Runtime + 'static>(
    app: &AppHandle<R>,
    generation: u64,
) {
    let lifecycle = app.state::<MainWindowLifecycleState>();
    if !lifecycle.handle_unexpected_window_destroyed(generation)
        || app.state::<AppExitState>().is_exit_requested()
    {
        return;
    }

    log_main_window_event(
        "destroyed",
        lifecycle.snapshot(),
        "native-window-event",
        "recreating-visible-window",
    );
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::task::yield_now().await;
        if let Err(error) = recreate_main_window(&app, "unexpected-destroy") {
            crate::log_error!("failed to recover destroyed visible window: {error}");
        }
    });
}

fn main_window_initialization_script(generation: u64) -> String {
    let script = format!(
        "(() => {{ Object.defineProperty(window, '{MAIN_WINDOW_GENERATION_PROPERTY}', {{ value: {generation}, writable: false, configurable: false }}); const applyPatinaMainWindowLabel = () => document.documentElement?.setAttribute('data-window-label', '{MAIN_WINDOW_LABEL}'); applyPatinaMainWindowLabel(); if (!document.documentElement) {{ document.addEventListener('DOMContentLoaded', applyPatinaMainWindowLabel, {{ once: true }}); }} }})();"
    );
    script
}

fn main_window_url() -> WebviewUrl {
    #[cfg(debug_assertions)]
    {
        let e2e_frontend_url = (std::env::var("PATINA_E2E").as_deref() == Ok("1")).then(|| {
            std::env::var("PATINA_E2E_FRONTEND_URL")
                .expect("PATINA_E2E_FRONTEND_URL is required when PATINA_E2E=1")
        });
        debug_main_window_url(e2e_frontend_url.as_deref())
    }

    #[cfg(not(debug_assertions))]
    {
        WebviewUrl::App("patina.html".into())
    }
}

#[cfg(debug_assertions)]
fn debug_main_window_url(e2e_frontend_url: Option<&str>) -> WebviewUrl {
    /* 融合要点：宿主是**双入口**（`index.html` = 悬浮条，`patina.html` = 本窗口）。
    上游只有一个入口，dev 地址写的是根路径；这里必须带上 `/patina.html`，
    否则开发模式下这扇窗口会加载 Timing 的悬浮条界面（表现为「窗口一片黑 / 尺寸不对」，
    而且 `ready` 事件永远等不到 → 窗口被 watchdog 判超时后保持隐藏）。

    另外 **dev 地址必须写 `127.0.0.1`**：Vite 的开发服务器绑的是 IPv4 回环
    （`vite.config.ts` 的 `server.host`），宿主的 `devUrl` 也是同一个字面量。历史上
    写过 `localhost`，结果 Node 把 `localhost` 解析成 `::1`、Vite 只监听 `[::1]:1420`，
    而 WebView2 先试 `127.0.0.1` → 连接被拒，症状是窗口停在 chrome-error 页、
    `ready` 永远等不到、watchdog 判超时后保持隐藏。三处（本文件 / `devUrl` /
    `vite.config.ts`）必须一起改。 */
    WebviewUrl::External(
        e2e_frontend_url
            .unwrap_or("http://127.0.0.1:1420/patina.html")
            .parse()
            .expect("valid dev server URL"),
    )
}

fn schedule_main_window_destroy_after_background<R: Runtime + 'static>(
    app: AppHandle<R>,
    hide_generation: u64,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(
            MAIN_WINDOW_DESTROY_AFTER_BACKGROUND_SECS,
        ))
        .await;

        let Some(window) = app.get_webview_window(MAIN_WINDOW_LABEL) else {
            return;
        };

        if window.is_visible().unwrap_or(false) {
            return;
        }

        let lifecycle = app.state::<MainWindowLifecycleState>();
        if !lifecycle.begin_destroy_hidden_window(hide_generation) {
            return;
        }

        let destroyed = match window.destroy() {
            Ok(()) => {
                log_main_window_event(
                    "destroyed",
                    lifecycle.snapshot(),
                    "background-idle",
                    "success",
                );
                true
            }
            Err(error) => {
                crate::log_error!("failed to destroy idle main window: {error}");
                false
            }
        };

        let should_reopen = lifecycle.finish_destroy_hidden_window(destroyed);
        if should_reopen && !app.state::<AppExitState>().is_exit_requested() {
            let _ = crate::app::insight::tray::show_main_window(&app, MainWindowShowReason::DestroyRecovery);
        }
    });
}

fn schedule_main_window_ready_timeout<R: Runtime + 'static>(
    app: AppHandle<R>,
    token: MainWindowRenderToken,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_secs(MAIN_WINDOW_READY_TIMEOUT_SECS)).await;

        let lifecycle = app.state::<MainWindowLifecycleState>();
        match lifecycle.handle_ready_timeout(token) {
            MainWindowTimeoutDecision::Stale => {}
            MainWindowTimeoutDecision::Hidden => {
                log_main_window_event(
                    "ready-timeout",
                    lifecycle.snapshot(),
                    "watchdog",
                    "kept-hidden",
                );
            }
        }
    });
}

fn schedule_main_window_liveness_timeout<R: Runtime + 'static>(
    app: AppHandle<R>,
    token: MainWindowRenderToken,
) {
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(Duration::from_millis(MAIN_WINDOW_LIVENESS_TIMEOUT_MILLIS)).await;

        let lifecycle = app.state::<MainWindowLifecycleState>();
        match lifecycle.handle_ready_timeout(token) {
            MainWindowTimeoutDecision::Stale => {}
            MainWindowTimeoutDecision::Hidden => {
                let snapshot = lifecycle.snapshot();
                log_main_window_event(
                    "liveness-probe-timeout",
                    snapshot,
                    "watchdog",
                    if snapshot.desired_visible {
                        "recreate-hidden-window"
                    } else {
                        "cancelled-while-hidden"
                    },
                );
                if snapshot.desired_visible && !app.state::<AppExitState>().is_exit_requested() {
                    if let Err(error) = recreate_main_window(&app, "liveness-timeout") {
                        crate::log_error!(
                            "failed to recreate unresponsive hidden window: {error}"
                        );
                    }
                }
            }
        }
    });
}

#[cfg(test)]
mod tests {
    #[cfg(debug_assertions)]
    use super::debug_main_window_url;
    use super::{main_window_initialization_script, main_window_url};
    use tauri::WebviewUrl;

    #[test]
    fn main_window_url_uses_dev_server_in_debug_builds() {
        let url = main_window_url();

        #[cfg(debug_assertions)]
        assert!(matches!(url, WebviewUrl::External(_)));

        #[cfg(not(debug_assertions))]
        assert!(matches!(url, WebviewUrl::App(_)));
    }

    #[test]
    fn main_window_generation_script_is_immutable_and_numeric() {
        let script = main_window_initialization_script(42);

        assert!(script.contains("__PATINA_MAIN_WINDOW_GENERATION__"));
        assert!(script.contains("value: 42"));
        assert!(script.contains("writable: false"));
        assert!(script.contains("configurable: false"));
        assert!(script.contains("document.documentElement?.setAttribute"));
        assert!(
            script.find("Object.defineProperty").unwrap()
                < script.find("document.documentElement").unwrap()
        );
    }

    #[cfg(debug_assertions)]
    #[test]
    fn debug_main_window_url_accepts_isolated_e2e_frontend() {
        let url = debug_main_window_url(Some("http://127.0.0.1:43123"));

        match url {
            WebviewUrl::External(url) => assert_eq!(url.as_str(), "http://127.0.0.1:43123/"),
            _ => panic!("expected external E2E frontend URL"),
        }
    }
}
