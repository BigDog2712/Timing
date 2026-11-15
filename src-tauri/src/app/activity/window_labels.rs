//! 窗口 label 的**唯一映射表**（去 Patina 化 T04）。
//!
//! 三个原生 label 各自的字面值仍在它们各自的模块里（`main_window::MAIN_WINDOW_LABEL` /
//! 本模块 `MINI_WINDOW_LABEL` / `tool_notifications::WINDOW_LABEL`），本模块只做两件事：
//!   1. `WindowKind::ALL` —— 把枚举顺序**显式**写出来。以前是
//!      `["patina", "mini", "tool-notification"][index]`，与枚举声明顺序隐式耦合：谁往枚举里
//!      插一个成员，label 就整体错位、探针打到别的窗，而且编译期一句话都不说。
//!   2. `WindowKind::label()` —— 变体 → label 的映射。
//!
//! 为什么单独一个文件而不是塞进 `webview_recovery.rs`：那个文件已在上限冻结基线里
//! （`check:size` 棘轮只许减不许增），加一个 `impl` 会直接把门禁顶红。跨窗的映射本来也不
//! 只属于 webview_recovery，放这里更顺。

use super::webview_recovery::WindowKind;

/// 迷你窗的原生 label。值不变（`"mini"`），本常量存在的意义是**收敛裸字面量**：
/// 它此前散在 `mini_window.rs` / `watcher.rs` / `native.rs` 共 8 处取窗调用里，
/// 谁要改 label 就得靠全仓搜索，漏一处就是「窗开出来了却拿不到它」。
pub(crate) const MINI_WINDOW_LABEL: &str = "mini";

impl WindowKind {
    /// 下标 = `snapshot()` 里 `windows[index]` 的顺序，必须与枚举声明顺序一致且**显式**列出。
    pub(crate) const ALL: [WindowKind; 3] = [
        WindowKind::Main,
        WindowKind::Mini,
        WindowKind::ToolNotification,
    ];

    /// 变体 → 原生 window label。
    pub(crate) fn label(self) -> &'static str {
        match self {
            WindowKind::Main => super::main_window::MAIN_WINDOW_LABEL,
            WindowKind::Mini => MINI_WINDOW_LABEL,
            WindowKind::ToolNotification => super::tool_notifications::WINDOW_LABEL,
        }
    }
}
