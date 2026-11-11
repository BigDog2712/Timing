//! 多窗口域命令（V0.2.0 / ADR-009）。含设置面板、事项窗口与便利贴窗口。
//!
//! 仅做「反序列化 -> 调 service/infra -> 返回」，无业务、无 SQL。

use tauri::{AppHandle, State};

use crate::app::events;
#[cfg(desktop)]
use crate::app::insight::main_window::tools_navigation::{self as patina_nav, HistoryTarget};
use crate::error::AppResult;
use crate::infra::window;
use crate::services;
use crate::state::AppState;

/// 打开 / 聚焦设置面板（单例；已存在则前置聚焦，不重复创建）。
#[tauri::command]
pub async fn open_settings_window(app: AppHandle) -> AppResult<()> {
    window::open_settings_window(&app)
}

/// 打开 / 聚焦事项窗口（单例；label `todos`）。
#[tauri::command]
pub async fn open_todos_window(app: AppHandle) -> AppResult<()> {
    window::open_todos_window(&app)
}

/// 打开 / 聚焦只读计时器窗口（单例；label `timer`）。
#[tauri::command]
pub async fn open_timer_window(app: AppHandle) -> AppResult<()> {
    window::open_timer_window(&app)
}

/// 打开 / 聚焦便利贴窗口（动态 label `note-{id}`；超上限 → `WINDOW_LIMIT_EXCEEDED`）。
#[tauri::command]
pub async fn open_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let note = services::note::open_guard(&state.pool, note_id).await?;
    window::open_note_window(&app, &note)?;
    events::emit_note_window(&app, true, note_id);
    Ok(())
}

/// 收纳便利贴窗口：落盘几何 + 置 `is_open=0` + 销毁窗口 + emit `note-window-closed`。
#[tauri::command]
pub async fn close_note_window(
    app: AppHandle,
    state: State<'_, AppState>,
    note_id: i64,
) -> AppResult<()> {
    let geometry = window::note_geometry(&app, note_id);
    services::note::close(&state.pool, note_id, geometry).await?;
    window::close_note_window(&app, note_id)?;
    events::emit_note_window(&app, false, note_id);
    Ok(())
}

/* ---- [V0.12.0 Patina 融合] 时间统计窗口 -------------------------------------

这条命令是**宿主自己的**命令。为什么不直接让前端 invoke Patina 的
`cmd_show_main_window`：那条命令写在 `permissions/window-commands.toml` 里，
ACL 只授权给 `windows: ["patina"]`，从宿主窗口调用会被 Tauri 拒掉
（`not allowed on window "main" … allowed on: [windows: "patina"]`）。
宿主自己的命令没有 permission 声明，天然对所有窗口开放，也不必把 Timing 的
前端绑到 Patina 的命令名上（宿主继续走 `IpcApi` 的 typed 契约）。

窗的生命周期仍归 Patina：它自己管「最后可见 / 重建 / 就绪握手」，这里只递一个
show 请求。返回 false = 窗正在重建或还没就绪（点第二次就好），不当错误。 */

/// 分析窗历史页落点（[P0-03]，`open_patina_window` 的**可选**参数）。
///
/// 命名口径（硬约定，FUSION-ARCH-v1 §6.6）：宿主`药丸`的窗口 label 是 `main`，
/// 分析窗的 label 是 `patina`；本结构描述「分析窗该落到哪里」，与窗口名无关。
#[cfg(desktop)]
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatinaHistoryTarget {
    /// 本地日 `YYYY-MM-DD`（宿主 `src/lib/dateKey.ts` 的 `todayDateKey()`）。
    date_key: String,
    /// 想在分析窗里聚焦的应用名（可空；分析窗侧以高亮环消费）。
    #[serde(default)]
    focus_app: Option<String>,
}

/// `open_patina_window` 的可选落点。省略 = 只把分析窗叫到前台（V0.12.0 原行为）。
///
/// `history` / `settings` / `overview` 三键互斥（`{ "history": { … } }` / `{ "settings": true }` /
/// `{ "overview": true }`）。并存时判序 **history > settings > overview**，与前端网关
/// （`src/platform/desktop/mainToolsNavigationGateway.ts`）同一条规则。
#[cfg(desktop)]
#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PatinaOpenTarget {
    #[serde(default)]
    history: Option<PatinaHistoryTarget>,
    /// [0.12.1] `true` = 分析窗的设置视图（独立设置窗下线后，所有「打开设置」入口的落点）。
    #[serde(default)]
    settings: bool,
    #[serde(default)]
    overview: bool,
}

/// 派发用的已解析落点。
#[cfg(desktop)]
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum OpenTarget {
    History(HistoryTarget),
    Settings,
    Overview,
}

#[cfg(desktop)]
impl PatinaOpenTarget {
    /// 落点 → 待消费视图：**history > settings > overview**；三个都没给 → `None`（= 只 show）。
    fn into_view(self) -> Option<OpenTarget> {
        if self.history.is_some() {
            return self.into_history_target().map(OpenTarget::History);
        }
        if self.settings {
            return Some(OpenTarget::Settings);
        }
        self.overview.then_some(OpenTarget::Overview)
    }

    /// 历史分支：空日期（前端不该发）→ `None`，调用方退化成「只 show」，绝不乱跳某一天。
    fn into_history_target(self) -> Option<HistoryTarget> {
        let Some(history) = self.history else {
            return None;
        };
        let date_key = history.date_key.trim().to_string();
        if date_key.is_empty() {
            crate::log_warn!("open_patina_window: empty history date; falling back to show only");
            return None;
        }
        Some(HistoryTarget {
            date_key,
            focus_app: history.focus_app,
        })
    }
}

/// 只把分析窗叫到前台（V0.12.0 原路径）：未就绪不是错误，用户再点一次即可。
#[cfg(desktop)]
fn show_patina_window(app: &AppHandle) {
    if !crate::app::insight::tray::show_main_window(
        app,
        crate::app::insight::main_window::MainWindowShowReason::TrayMenu,
    ) {
        crate::log_warn!("patina main window is not ready yet; the next request will retry");
    }
}

#[cfg(desktop)]
#[tauri::command]
pub async fn open_patina_window(
    app: AppHandle,
    target: Option<PatinaOpenTarget>,
) -> AppResult<()> {
    let Some(view) = target.and_then(PatinaOpenTarget::into_view) else {
        show_patina_window(&app);
        return Ok(());
    };

    /* 先写 pending 再 show（`open_history` / `open_overview` 内部保证），冷启动才拿得到目标。
       硬失败时 pending 已被回滚，本命令仍按既有口径返回 Ok——「窗没起来」不是用户操作失败。 */
    let navigation = match view {
        OpenTarget::History(history) => patina_nav::open_history(&app, history),
        OpenTarget::Settings => patina_nav::open_settings(&app),
        OpenTarget::Overview => patina_nav::open_overview(&app),
    };
    if let Err(error) = navigation {
        crate::log_warn!("patina target rolled back ({error}); the next request will retry");
    }
    Ok(())
}

/* 载荷形状的单测：这条通道的另一半（真实的窗口生命周期）只能手测，但「前端 JSON 到底被
   反序列化成什么」是可以在单测里钉死的——尤其是 `null` 与 `Option` 的边界，以及空日期
   必须退化成「只 show」而不是乱跳。 */
#[cfg(all(test, desktop))]
mod tests {
    use super::*;

    fn parse(raw: &str) -> Result<Option<PatinaOpenTarget>, serde_json::Error> {
        serde_json::from_str::<Option<PatinaOpenTarget>>(raw)
    }

    #[test]
    fn explicit_null_target_is_absence_so_the_existing_open_path_is_untouched() {
        /* 前端在「只要把分析窗叫到前台」时显式传 `{ "target": null }`（设置页
           「时间统计 · 打开」就是这条路径）。钉住 null → None：新参数不能把 V0.12.0
           的既有入口带坏。 */
        assert!(parse("null").expect("null 是合法的「没有落点」").is_none());
    }

    #[test]
    fn history_target_deserializes_camel_case_and_keeps_focus_app() {
        let target = parse(r#"{"history":{"dateKey":"2026-11-10","focusApp":"Code.exe"}}"#)
            .expect("camelCase 载荷应可反序列化")
            .expect("有落点");
        let history = target.into_history_target().expect("日期非空");
        assert_eq!(history.date_key, "2026-11-10");
        assert_eq!(history.focus_app.as_deref(), Some("Code.exe"));
    }

    #[test]
    fn focus_app_is_optional() {
        let target = parse(r#"{"history":{"dateKey":"2026-01-05"}}"#)
            .expect("focusApp 可省")
            .expect("有落点");
        let history = target.into_history_target().expect("日期非空");
        assert_eq!(history.focus_app, None);
    }

    #[test]
    fn unknown_fields_and_blank_dates_are_rejected_instead_of_jumping() {
        assert!(parse(r#"{"history":{"dateKey":"2026-01-05","bogus":1}}"#).is_err());
        let blank = parse(r#"{"history":{"dateKey":"   "}}"#)
            .expect("形状合法")
            .expect("有落点");
        assert!(
            blank.into_history_target().is_none(),
            "空日期必须退化成「只 show」，不许乱跳"
        );
    }

    #[test]
    fn overview_parses_and_history_wins_when_both_are_sent() {
        let view = |raw: &str| parse(raw).expect("形状合法").expect("有落点").into_view();
        assert!(matches!(view(r#"{"overview":true}"#), Some(OpenTarget::Overview)));
        assert!(view(r#"{"overview":false}"#).is_none());
        let both = view(r#"{"overview":true,"history":{"dateKey":"2026-11-10"}}"#);
        assert!(matches!(both, Some(OpenTarget::History(_))));
    }

    /* [0.12.1] 设置落点：独立设置窗下线后，「托盘设置…」「药丸 settings.open」都发这一份载荷。 */
    #[test]
    fn settings_target_parses_alone() {
        let view = |raw: &str| parse(raw).expect("形状合法").expect("有落点").into_view();
        assert!(matches!(view(r#"{"settings":true}"#), Some(OpenTarget::Settings)));
        /* `false` = 「没指定落点」，必须退化成「只 show」，与 overview 同口径 */
        assert!(view(r#"{"settings":false}"#).is_none());
    }

    #[test]
    fn settings_wins_over_overview() {
        /* 判序 history > settings > overview：两个都给时先落设置页 */
        let view = |raw: &str| parse(raw).expect("形状合法").expect("有落点").into_view();
        let both = view(r#"{"settings":true,"overview":true}"#);
        assert!(matches!(both, Some(OpenTarget::Settings)));
    }

    #[test]
    fn history_wins_over_settings() {
        let view = |raw: &str| parse(raw).expect("形状合法").expect("有落点").into_view();
        let both = view(r#"{"history":{"dateKey":"2026-11-10"},"settings":true}"#);
        assert!(matches!(both, Some(OpenTarget::History(_))));
    }
}
