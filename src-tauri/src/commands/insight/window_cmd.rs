use crate::app::insight::main_window;
use crate::app::insight::state::MainWindowRenderToken;
use crate::commands::insight::error::CommandErrorDto;
use serde::Serialize;
use tauri::{AppHandle, Manager, WebviewWindow};

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowReadyResultDto {
    outcome: &'static str,
    generation: u64,
    load_epoch: u64,
}

#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowRenderTokenDto {
    generation: u64,
    load_epoch: u64,
}

#[tauri::command]
pub async fn cmd_minimize_main_window(app: AppHandle) -> Result<(), CommandErrorDto> {
    main_window::minimize_main_window(&app)
        .await
        .map_err(|error| CommandErrorDto::new("MAIN_WINDOW_MINIMIZE_FAILED", error, true))
}

#[tauri::command]
pub async fn cmd_show_desktop(window: WebviewWindow) -> Result<(), CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "SHOW_DESKTOP_INVALID_CALLER",
            "only the main window can show the desktop",
            false,
        ));
    }
    crate::app::insight::main_window::show_desktop()
        .await
        .map_err(|error| CommandErrorDto::new("SHOW_DESKTOP_FAILED", error, true))
}

#[tauri::command]
pub fn cmd_e2e_destroy_hidden_main_window(app: AppHandle) -> Result<(), CommandErrorDto> {
    main_window::destroy_hidden_main_window_for_e2e(&app)
        .map_err(|error| CommandErrorDto::new("E2E_MAIN_WINDOW_DESTROY_FAILED", error, false))
}

#[tauri::command]
pub fn cmd_get_main_window_render_token(
    window: WebviewWindow,
) -> Result<MainWindowRenderTokenDto, CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "MAIN_WINDOW_READY_INVALID_CALLER",
            "only the main window can read main-window render state",
            false,
        ));
    }

    let token =
        main_window::current_main_window_render_token(window.app_handle()).ok_or_else(|| {
            CommandErrorDto::new(
                "MAIN_WINDOW_READY_UNAVAILABLE",
                "main-window render state is unavailable",
                true,
            )
        })?;

    Ok(MainWindowRenderTokenDto {
        generation: token.generation,
        load_epoch: token.load_epoch,
    })
}

#[tauri::command]
pub fn cmd_mark_main_window_ready(
    window: WebviewWindow,
    generation: u64,
    load_epoch: u64,
) -> Result<MainWindowReadyResultDto, CommandErrorDto> {
    if window.label() != main_window::MAIN_WINDOW_LABEL {
        return Err(CommandErrorDto::new(
            "MAIN_WINDOW_READY_INVALID_CALLER",
            "only the main window can report main-window readiness",
            false,
        ));
    }

    let token = MainWindowRenderToken {
        generation,
        load_epoch,
    };
    let outcome = main_window::mark_main_window_ready(window.app_handle(), token)
        .map_err(|error| CommandErrorDto::new("MAIN_WINDOW_READY_REVEAL_FAILED", error, true))?;

    Ok(MainWindowReadyResultDto {
        outcome: outcome.as_str(),
        generation,
        load_epoch,
    })
}

#[tauri::command]
pub async fn cmd_show_main_window(app: tauri::AppHandle) {
    crate::app::insight::tray::show_main_window(&app, main_window::MainWindowShowReason::Mini);
}

/// 历史页落点 DTO（[P0-03]）：`{ "dateKey": "2026-11-10", "focusApp": "Code.exe" }`。
/// `focusApp` 缺省时序列化成 `null`（前端按可空字符串解析），不做 `skip`——
/// 消费方是分析窗自己的网关，字段恒定比「有时没有」更好写分支。
#[derive(Clone, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryTargetDto {
    date_key: String,
    focus_app: Option<String>,
}

/// 宿主`药丸`（label = `main`）→ 分析窗（label = `patina`）的一次性落点。
///
/// 四个字段互斥且都可省略：`{ "tools": "pomodoro" }` / `{ "history": { … } }` /
/// `{ "settings": true }`（0.12.1 设置视图）/ `{ "overview": true }`。V0.12.0 的形状是裸枚举
/// （`"pomodoro" | "reminders" | null`），改成带标签的对象是为了容纳后三者；
/// **命令名与条数不变**（仍是 117 条之一）。
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainWindowTargetDto {
    #[serde(skip_serializing_if = "Option::is_none")]
    tools: Option<main_window::tools_navigation::ToolsSection>,
    #[serde(skip_serializing_if = "Option::is_none")]
    history: Option<HistoryTargetDto>,
    #[serde(skip_serializing_if = "Option::is_none")]
    settings: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none")]
    overview: Option<bool>,
}

impl MainWindowTargetDto {
    fn from_pending(view: main_window::tools_navigation::PendingView) -> Self {
        use main_window::tools_navigation::{HistoryTarget, PendingView};
        /* 每个分支只写自己那一个键，其余靠 `Default`（全 None）补齐：
           万一哪天加了第四个落点，不必再逐个分支补三个 `None`。 */
        match view {
            PendingView::Tools(section) => Self {
                tools: Some(section),
                ..Self::default()
            },
            PendingView::History(HistoryTarget {
                date_key,
                focus_app,
            }) => Self {
                history: Some(HistoryTargetDto {
                    date_key,
                    focus_app,
                }),
                ..Self::default()
            },
            PendingView::Settings => Self {
                settings: Some(true),
                ..Self::default()
            },
            PendingView::Overview => Self {
                overview: Some(true),
                ..Self::default()
            },
        }
    }
}

#[tauri::command]
pub fn cmd_take_main_tools_target(
    window: WebviewWindow,
) -> Result<Option<MainWindowTargetDto>, String> {
    super::window_guard::require_main_window_string(&window)?;
    Ok(window
        .app_handle()
        .state::<main_window::tools_navigation::ToolsNavigationState>()
        .take()
        .map(MainWindowTargetDto::from_pending))
}

#[cfg(test)]
mod tests {
    use super::*;
    use main_window::tools_navigation::PendingView;

    #[test]
    fn overview_pending_serializes_to_the_single_key_the_gateway_reads() {
        let json = serde_json::to_value(MainWindowTargetDto::from_pending(PendingView::Overview))
            .expect("可序列化");
        assert_eq!(json, serde_json::json!({ "overview": true }));
    }

    /* [0.12.1] 设置落点：前端网关按 `{"settings":true}` 这个单键解析（见
       `mainToolsNavigationGateway.ts` 的 `kind:"settings"`）。多一个键都会让判序变味。 */
    #[test]
    fn settings_pending_serializes_to_the_single_key_the_gateway_reads() {
        let json = serde_json::to_value(MainWindowTargetDto::from_pending(PendingView::Settings))
            .expect("可序列化");
        assert_eq!(json, serde_json::json!({ "settings": true }));
    }
}
