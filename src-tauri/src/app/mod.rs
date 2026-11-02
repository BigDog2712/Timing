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
pub mod diagnostics;
pub mod events;
pub mod tray;
