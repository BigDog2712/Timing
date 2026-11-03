//! 装配层（app）：把 services 与平台适配接起来。
//!
//! 这一层解决的问题是「谁都想要、但谁都不该拥有」的那类胶水：
//! - `events`：读业务状态再广播（services 不该知道 Tauri 事件，infra 又不许依赖 services）；
//! - `tray`：原生菜单装配 + 菜单项 -> 计时动作的派发；
//! - `bootstrap`：启动顺序；
//! - `diagnostics`：启动现场快照。
//!
//! 允许依赖：`services` / `infra` / `platform` / `models`。
//! 禁止：被 `infra` 反向依赖（否则又成环）。

pub mod bootstrap;
pub mod events;

/* 桌面独占（V1-Android）：
- `tray`：`TrayIconBuilder` / 原生菜单在 Android 上不存在；
- `diagnostics`：快照里要枚举显示器与各窗口 label，两者都是桌面概念。
移动端不写这两份快照——出问题时看日志与 `boot_timing` 即可。 */
#[cfg(desktop)]
pub mod diagnostics;
#[cfg(desktop)]
pub mod tray;
