//! 系统托盘：图标常驻 + 原生菜单（ADR-013「保留原生 Win32 菜单，不自绘」）。
//!
//! 菜单**内容组织**全部由纯函数 `infra::tray_menu` 决定（便于单测）；本模块只做
//! 「节点 -> Tauri 菜单对象」的装配、状态迁移时的重建、以及菜单项的副作用分发。
//!
//! 刷新纪律（K-30 / ADR-013 §3.3.2）：菜单结构**仅在计时状态迁移时重建**，
//! 秒级时间不每 tick 重建（`emit_timer_state` 只在状态变更路径上调用）。

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

use crate::infra::{events, tray_menu, window};
use crate::models::enums::{ResolveAction, TrayStatus};
use crate::models::timer::TraySnapshot;
use crate::services;
use crate::state::AppState;

/// 托盘图标 id（`tray_by_id` 检索用）。
const TRAY_ID: &str = "tickbar-tray";

/// 构建托盘（启动时一次）。初始菜单取空闲态快照。
pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let menu = build_menu(app, &TraySnapshot::idle())?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("TickBar")
        .on_menu_event(|app, event| on_menu_event(app, event.id.as_ref()))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                let app = tray.app_handle();
                let _ = window::toggle(app);
                let _ = app.emit("tray:toggle-visibility", ());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }
    builder.build(app)?;
    Ok(())
}

/// 按当前计时状态重建托盘菜单（状态迁移时调用；见 `events::emit_timer_state`）。
///
/// 托盘可能尚未创建（启动早期 / 无托盘环境）→ 静默跳过。
pub fn sync_status(app: &AppHandle, snapshot: &TraySnapshot) {
    let Some(tray) = app.tray_by_id(TRAY_ID) else {
        return;
    };
    match build_menu(app, snapshot) {
        Ok(menu) => {
            if let Err(err) = tray.set_menu(Some(menu)) {
                eprintln!("[tickbar] tray set_menu failed: {err}");
            }
        }
        Err(err) => eprintln!("[tickbar] build tray menu failed: {err}"),
    }
}

/// 由状态快照装配原生菜单。
fn build_menu(app: &AppHandle, snapshot: &TraySnapshot) -> tauri::Result<Menu<tauri::Wry>> {
    let line = match snapshot.status {
        TrayStatus::Countdown => tray_menu::countdown_status_line(
            &snapshot.item_name,
            snapshot.remaining_sec.unwrap_or(0),
        ),
        _ => tray_menu::status_line(snapshot.status, &snapshot.item_name, snapshot.duration_sec),
    };
    let menu = Menu::new(app)?;
    for node in tray_menu::build_nodes(snapshot.status, &line) {
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
        tray_menu::ID_SHOW_HIDE => {
            let _ = window::toggle(app);
            let _ = app.emit("tray:toggle-visibility", ());
        }
        tray_menu::ID_NEW_ITEM => {
            let _ = window::show_main(app);
            let _ = app.emit("app:open-new-item", ());
        }
        tray_menu::ID_OPEN_SETTINGS => {
            if let Err(err) = window::open_settings_window(app) {
                eprintln!("[tickbar] open settings window failed: {err}");
            }
        }
        tray_menu::ID_OPEN_TODOS => {
            if let Err(err) = window::open_todos_window(app) {
                eprintln!("[tickbar] open todos window failed: {err}");
            }
        }
        // 「编辑固定任务…」/「便利贴…」需前端弹应用内菜单 / 建窗，故先显主窗再 emit 应用内事件。
        tray_menu::ID_OPEN_COMMON_ITEMS => {
            let _ = window::show_main(app);
            let _ = app.emit(events::APP_OPEN_COMMON_ITEMS, ());
        }
        tray_menu::ID_OPEN_NOTE => {
            let _ = window::show_main(app);
            let _ = app.emit(events::APP_OPEN_NEW_NOTE, ());
        }
        tray_menu::ID_QUIT => app.exit(0),
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
                services::timer::resolve_open(&pool, ResolveAction::Discard, None)
                    .await
                    .map(|_| ())
            }
        };
        if let Err(err) = result {
            eprintln!("[tickbar] tray timer action failed: {err}");
        }
        // 成败都回读权威状态：失败（如「已在计时」）时刷新前端与托盘，避免显示过期。
        events::emit_timer_state(&app, &pool).await;
    });
}
