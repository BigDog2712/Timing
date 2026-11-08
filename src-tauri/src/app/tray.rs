//! 系统托盘：图标常驻 + 原生菜单（ADR-013「保留原生 Win32 菜单，不自绘」）。
//!
//! 菜单**内容组织**全部由纯函数 `infra::tray_menu` 决定（便于单测）；本模块只做
//! 「节点 -> Tauri 菜单对象」的装配、状态迁移时的重建、以及菜单项的副作用分发。
//!
//! 刷新纪律（K-30 / ADR-013 §3.3.2）：菜单结构**仅在计时状态迁移时重建**，
//! 秒级时间不每 tick 重建（`emit_timer_state` 只在状态变更路径上调用）。
//!
//! 本模块只做「派发」；「Markdown 同步」点完之后那一整套动作在 `app::tray_sync`
//! （单文件 ≤300 行，ADR-017）。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::app::{events, tray_label, tray_quit, tray_sync};
use crate::infra::{tray_menu, window};
use crate::models::enums::{ResolveAction, TrayStatus};
use crate::models::timer::TraySnapshot;
use crate::services;
use crate::state::AppState;

/// 托盘图标 id（`tray_by_id` 检索用）。
const TRAY_ID: &str = "timing-tray";

/// 托盘专用图标（64×64 PNG，编译期嵌入）。
///
/// 与窗口/桌面图标分开是刻意的：底板图标在 16×16 的通知区里会缩成一团深色块，
/// 托盘版去掉底板、加粗环身、开口更小，只留环形本体——尺寸见 `scripts/gen-icon.py`。
const TRAY_ICON_PNG: &[u8] = include_bytes!("../../icons/tray.png");

/// 构建托盘（启动时一次）。初始菜单取空闲态快照。
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    /* [V0.11.18] 启动期配置还没加载，同步项先说「Markdown 同步」——安全默认：
    说「云端同步」而云端其实没配，比反过来更糟。下一次状态迁移（`events::sync_tray`）
    就会用 `tray_sync::sync_label` 读到的真值修正它。 */
    let menu = build_menu(app, &TraySnapshot::idle(), tray_label::LOCAL_LABEL, false)?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Timing")
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            let app = tray.app_handle();
            match event {
                /* [V0.3.1] 单击托盘**只显不隐**：显隐功能已按用户口径移除，
                但「小条被关掉（Alt+F4 → K-5 隐藏）后怎么叫回来」仍需一条路。 */
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } => {
                    let _ = window::show_main(app);
                }
                /* 双击 = 高亮定位：把小条叫出来并让它闪一下（颜色见设置里的「高亮颜色」）。 */
                TrayIconEvent::DoubleClick {
                    button: MouseButton::Left,
                    ..
                } => {
                    let _ = window::show_main(app);
                    let _ = app.emit(events::TRAY_HIGHLIGHT, ());
                }
                _ => {}
            }
        });

    match tauri::image::Image::from_bytes(TRAY_ICON_PNG) {
        Ok(icon) => builder = builder.icon(icon),
        // 解码失败（资源损坏）时退回窗口图标，至少托盘还在。
        Err(err) => {
            crate::log_warn!("tray icon decode failed: {err}");
            if let Some(icon) = app.default_window_icon().cloned() {
                builder = builder.icon(icon);
            }
        }
    }
    builder.build(app)?;
    Ok(())
}

/// 按当前计时状态重建托盘菜单（状态迁移时调用；见 `events::emit_timer_state`）。
///
/// 托盘可能尚未创建（启动早期 / 无托盘环境）→ 静默跳过。
///
/// [V0.11.18] `sync_label` 由调用方（`events::sync_tray` 的装配路径）用
/// `tray_sync::sync_label` 读好传进来：本模块不做「哪个通道生效」的判断，
/// 那件事的判据只允许有一份（`md_cloud::usable`）。
pub fn sync_status(app: &AppHandle, snapshot: &TraySnapshot, sync_label: &str) {
    rebuild(app, snapshot, sync_label, false);
}

/// [V0.11.18] 退出前那一轮同步开始时重建一次：退出项变「正在同步…」+ 禁用（PRD B7）。
///
/// 单独一个入口而不是给 `sync_status` 加参数：调用方就两个，而「什么时候该说正在同步」
/// 是个不该溜进状态迁移路径的判断（K-30 的重建时机就是被这类参数开的洞弄乱的）。
pub fn sync_status_quitting(app: &AppHandle, snapshot: &TraySnapshot, sync_label: &str) {
    rebuild(app, snapshot, sync_label, true);
}

/// 重建托盘菜单的**唯一**实现：`quitting` 只影响退出项（见 `tray_menu::build_nodes`）。
fn rebuild(app: &AppHandle, snapshot: &TraySnapshot, sync_label: &str, quitting: bool) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app, snapshot, sync_label, quitting) {
        Ok(menu) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                crate::log_warn!("tray set_menu failed: {err}");
            }
        }
        Err(err) => crate::log_warn!("build tray menu failed: {err}"),
    }
}

/// 由状态快照装配原生菜单。
fn build_menu(
    app: &AppHandle,
    snapshot: &TraySnapshot,
    sync_label: &str,
    quitting: bool,
) -> tauri::Result<Menu<tauri::Wry>> {
    let line = match snapshot.status {
        TrayStatus::Countdown => tray_menu::countdown_status_line(
            &snapshot.item_name,
            snapshot.remaining_sec.unwrap_or(0),
        ),
        _ => tray_menu::status_line(snapshot.status, &snapshot.item_name, snapshot.duration_sec),
    };
    let menu = Menu::new(app)?;
    for node in tray_menu::build_nodes(snapshot.status, &line, sync_label, quitting) {
        match node {
            tray_menu::TrayNode::Separator => menu.append(&PredefinedMenuItem::separator(app)?)?,
            tray_menu::TrayNode::Item { id, label, enabled } => {
                menu.append(&MenuItem::with_id(app, id, &label, enabled, None::<&str>)?)?
            }
        }
    }
    Ok(menu)
}

/// 菜单项点击分发（`on_menu_event`）。
fn on_menu_event(app: &AppHandle, id: &str) {
    match id {
        tray_menu::ID_NEW_ITEM => {
            let _ = window::show_main(app);
            let _ = app.emit(events::APP_OPEN_NEW_ITEM, ());
        }
        tray_menu::ID_OPEN_SETTINGS => {
            if let Err(err) = window::open_settings_window(app) {
                crate::log_warn!("open settings window failed: {err}");
            }
        }
        tray_menu::ID_OPEN_TODOS => {
            if let Err(err) = window::open_todos_window(app) {
                crate::log_warn!("open todos window failed: {err}");
            }
        }
        // 「便利贴…」需前端建窗，故先显主窗再 emit 应用内事件。
        tray_menu::ID_OPEN_NOTE => {
            let _ = window::show_main(app);
            let _ = app.emit(events::APP_OPEN_NEW_NOTE, ());
        }
        tray_menu::ID_MD_SYNC => tray_sync::spawn(app),
        /* [V0.11.18] 退出不再是无条件 `app.exit(0)`：先跑一轮同步，硬上限 3 秒，
        超时照样退出（PRD §13.3.1 / B7）。杀进程那条路**什么都不做**（B9）。 */
        tray_menu::ID_QUIT => tray_quit::quit_after_sync(app),
        tray_menu::ID_TIMER_START => spawn_action(app, TrayAction::Start),
        tray_menu::ID_TIMER_PAUSE => spawn_action(app, TrayAction::Pause),
        tray_menu::ID_TIMER_RESUME => spawn_action(app, TrayAction::Resume),
        tray_menu::ID_TIMER_STOP => spawn_action(app, TrayAction::Stop),
        tray_menu::ID_TIMER_DISCARD => spawn_action(app, TrayAction::Discard),
        _ => {}
    }
}

/// 托盘控制组可触发的计时动作。
#[derive(Clone, Copy)]
enum TrayAction {
    Start,
    Pause,
    Resume,
    Stop,
    Discard,
}

/// 在异步运行时执行计时动作，随后刷新权威状态（`timer:state-changed` + 托盘重建）。
fn spawn_action(app: &AppHandle, action: TrayAction) {
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        let pool = app.state::<AppState>().pool.clone();
        let result = match action {
            TrayAction::Start => services::timer::start(&pool, None).await.map(|_| ()),
            TrayAction::Pause => services::timer::pause(&pool).await.map(|_| ()),
            TrayAction::Resume => services::timer::resume(&pool).await.map(|_| ()),
            TrayAction::Stop => services::timer::stop(&pool).await.map(|_| ()),
            TrayAction::Discard => {
                services::timer::resolve_open(&pool, ResolveAction::Discard, None, false)
                    .await
                    .map(|_| ())
            }
        };
        if let Err(err) = result {
            crate::log_warn!("tray timer action failed: {err}");
        }
        // 成败都回读权威状态：失败（如「已在计时」）时刷新前端与托盘，避免显示过期。
        events::emit_timer_state(&app, &pool).await;
    });
}
