//! 分析窗「待消费落点」通道（W-01：工具分区跳转；P0-03：历史页落点；P1-02：总览页落点；
//! 0.12.1：设置视图落点）。
//!
//! **窗口 label 与直觉相反，读代码前先记住这一条**：
//!   · 本模块所在的 `main_window` 指**分析窗**，`MAIN_WINDOW_LABEL = "patina"`；
//!   · 宿主`药丸`的 label 是 `main`（`src-tauri/tauri.conf.json` 的 `windows[0].label`）。
//! 所以「发给药丸」必须 `emit_to("main", …)`，而本模块的 `emit_to(MAIN_WINDOW_LABEL, …)`
//! 是**发给分析窗**。注释里禁止用裸 `main` 表示药丸，一律写「药丸（label = main）」。
//!
//! 生命周期（FUSION-ARCH-v1 §6.3）：
//!   · 写入方：宿主命令 `open_patina_window(target?)`（唯一入口）；
//!   · 消费方：只有分析窗（`cmd_take_main_tools_target` 带 `require_main_window_string` 守卫）；
//!   · `take()` 即清空，一次性；后写覆盖先写（目标幂等，连点两次只落最后一次）；
//!   · 唤醒事件 `main-tools-target-changed` 只是「该来取一次」的门铃，**不带载荷**；
//!     冷启动时它必然丢失，靠分析窗「挂载时先订阅、后 take」兜底——所以这里必须
//!     **先写 state 再 show**，顺序反了冷启动就拿不到目标。
use crate::models::insight::events::MAIN_TOOLS_TARGET_CHANGED;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime};

/// 工具页分区。
///
/// serde 形状**不能动**：迷你窗的 `{ "kind": "open_tools", "section": … }` 直接反序列化
/// 到本枚举（`src-tauri/src/app/insight/mini_window.rs` 的 `Action::OpenTools`），
/// 改 `rename_all` 或加字段都会让迷你窗的「打开工具」静默失效。
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ToolsSection {
    Pomodoro,
    Reminders,
}

/// 历史页落点（宿主`药丸`（label = main）→ 分析窗（label = patina）历史页的某一天）。
///
/// `date_key` 是**本地日** `YYYY-MM-DD`（宿主 `src/lib/dateKey.ts` 的 `todayDateKey()`）；
/// 不接受 UTC 截断出来的日期，否则跨时区用户每天有若干小时会落到前一天。
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct HistoryTarget {
    pub(crate) date_key: String,
    /// 想在分析窗里聚焦的应用名。值全程带着，由 `History` 侧派生为高亮键
    /// （不新增命令、不新增事件，也不改本通道的载荷形状）。
    pub(crate) focus_app: Option<String>,
}

/// 一次性待消费落点。`Tools` 分支的行为与 V0.12.0 逐字一致（含失败回滚语义）。
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum PendingView {
    Tools(ToolsSection),
    History(HistoryTarget),
    Settings,
    Overview,
}

#[derive(Default)]
pub(crate) struct ToolsNavigationState(Mutex<Option<PendingView>>);

impl ToolsNavigationState {
    /// 取走待消费落点并清空（一次性；重复调用返回 `None`）。
    pub(crate) fn take(&self) -> Option<PendingView> {
        self.0
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .take()
    }

    /// 覆盖写入（后写覆盖先写，不做队列）。
    fn put(&self, view: PendingView) {
        *self.0.lock().unwrap_or_else(|error| error.into_inner()) = Some(view);
    }
}

/// 写 pending → 显示分析窗 → 敲一次门铃（顺序不可换，见模块注释）。
///
/// 硬失败（建窗 / reveal 失败）时**回滚**：`take()` 掉刚写的目标，避免下一次分析窗
/// 起来时消费到一个陈旧落点、莫名其妙跳到别的页面。
/// 「还没就绪」（`Wait` / `Created` / `Creating`）**不回滚**——那正是冷启动要用的路径。
fn deliver<R: Runtime>(app: &AppHandle<R>, view: PendingView) -> Result<(), String> {
    let state = app.state::<ToolsNavigationState>();
    state.put(view);
    // `MainWindowShowReason` 只进日志（`show_main_window` 里唯一用途是 reason 字符串），
    // 沿用工具分区跳转的 `Mini` 不改变任何窗口行为；这里不新增枚举变体，免得再动 vendored。
    if !super::show_main_window(app, super::MainWindowShowReason::Mini) {
        state.take();
        return Err("Could not open the main window".into());
    }
    // A cold main WebView consumes the pending target after subscribing.
    let _ = app.emit_to(super::MAIN_WINDOW_LABEL, MAIN_TOOLS_TARGET_CHANGED, ());
    Ok(())
}

/// 打开分析窗工具页的指定分区（迷你窗 / 标题栏胶囊 / 托盘菜单共用）。
pub(crate) fn open<R: Runtime>(app: &AppHandle<R>, section: ToolsSection) -> Result<(), String> {
    deliver(app, PendingView::Tools(section))
}

/// 打开分析窗历史页的指定某一天（宿主`药丸`（label = main）的「今天」入口）。
pub(crate) fn open_history<R: Runtime>(
    app: &AppHandle<R>,
    target: HistoryTarget,
) -> Result<(), String> {
    deliver(app, PendingView::History(target))
}

/// 打开分析窗总览页（P1-02：摘要面板「在分析窗看总览 ↗」的落点）。
///
/// 走同一个 `deliver`：**先写 state 再 show**，冷启动才拿得到落点；不新增命令/事件。
pub(crate) fn open_overview<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    deliver(app, PendingView::Overview)
}

/// 打开分析窗的设置视图（0.12.1：独立设置窗下线后，托盘「设置…」与药丸手柄的落点）。
///
/// 与 `open_overview` 逐字同形：走同一个 `deliver`（**先写 state 再 show**），
/// 不新增命令、不新增事件；冷启动也能落对页。
pub(crate) fn open_settings<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    deliver(app, PendingView::Settings)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn history(date_key: &str, focus_app: Option<&str>) -> HistoryTarget {
        HistoryTarget {
            date_key: date_key.to_string(),
            focus_app: focus_app.map(str::to_string),
        }
    }

    #[test]
    fn latest_target_survives_until_consumed_once() {
        let state = ToolsNavigationState::default();
        assert_eq!(state.take(), None);
        state.put(PendingView::Tools(ToolsSection::Pomodoro));
        state.put(PendingView::Tools(ToolsSection::Reminders));
        assert_eq!(state.take(), Some(PendingView::Tools(ToolsSection::Reminders)));
        assert_eq!(state.take(), None);
    }

    #[test]
    fn history_target_is_consumed_once_and_overwrites_tools() {
        let state = ToolsNavigationState::default();
        let target = history("2026-11-10", Some("Code.exe"));
        state.put(PendingView::Tools(ToolsSection::Pomodoro));
        state.put(PendingView::History(target.clone()));
        assert_eq!(state.take(), Some(PendingView::History(target)));
        assert_eq!(state.take(), None);
    }

    #[test]
    fn overview_is_consumed_once_and_yields_to_a_later_history_target() {
        let state = ToolsNavigationState::default();
        state.put(PendingView::Tools(ToolsSection::Pomodoro));
        state.put(PendingView::Overview);
        assert_eq!(state.take(), Some(PendingView::Overview));
        assert_eq!(state.take(), None);
        state.put(PendingView::Overview);
        state.put(PendingView::History(history("2026-11-11", None)));
        assert!(matches!(state.take(), Some(PendingView::History(_))));
    }

    #[test]
    fn settings_is_consumed_once_and_yields_to_a_later_history_target() {
        let state = ToolsNavigationState::default();
        state.put(PendingView::Overview);
        state.put(PendingView::Settings);
        assert_eq!(state.take(), Some(PendingView::Settings));
        assert_eq!(state.take(), None);
        state.put(PendingView::Settings);
        state.put(PendingView::History(history("2026-11-11", None)));
        assert!(matches!(state.take(), Some(PendingView::History(_))));
    }

    #[test]
    fn history_target_keeps_date_key_and_optional_focus_app() {
        let target = history("2026-01-05", None);
        assert_eq!(target.date_key, "2026-01-05");
        assert_eq!(target.focus_app, None);
        assert_eq!(HistoryTarget::default(), history("", None));
    }
}
