//! 前台窗口的最小对外形状（[0.13] 冷启动自动接管）。
//!
//! 为什么不直接回 `infra::insight::windows::foreground::WindowInfo`：
//!   1. 那张结构还带 `hwnd` / `process_path` / `title` / `app_user_model_id` —— 药丸只要
//!      「哪个 exe」这一个事实，多给的字段就是多一份泄露面；
//!   2. `infra::insight` 整棵是 `#[cfg(desktop)]`，而这条命令有**移动端桩**
//!      （`commands/window_cmd_mobile.rs`）。DTO 放在 `models/` 两端才会都有。
//!
//! 字段口径与 `active-window-changed` 事件载荷一致：`exeName` 是**未归一**的原始进程名，
//! 前端自己做 `normalizeAppKey`（归一只有一处实现，两边不许各写一份）。

use serde::Serialize;

/// 当前前台窗口 —— 只带自动接管要用的两个字段。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForegroundWindow {
    /// 原始进程名（如 `Yanyun.exe`）。空串不会出现在这份 DTO 里：命令层已折成 `None`。
    pub exe_name: String,
    /// 进程号。前端不用它做判断（前端拿不到自己的 pid），留给日志与排查。
    pub process_id: u32,
}
