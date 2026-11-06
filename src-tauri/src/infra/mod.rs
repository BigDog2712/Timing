//! 平台适配层（infra）：只碰 OS / Tauri 能力，**不依赖 services**。
//!
//! 分层目标（R5）：`infra` 是「可整体替换的平台叶子」——想把 SQLite 换掉、把托盘换成
//! 自绘，改动应止步于本层。因此这里不允许出现业务判断与用例编排。
//!
//! 已迁出的模块（v0.3 解环）：
//! - `clock` → `platform::clock`（被 services 使用，不需要 Tauri 能力）
//! - `events` / `tray` / `setup` → `app::*`（要读业务状态，属装配层）
//! - `runtime` / `monitor` / `reminder` / `countdown` / `note_windows::restore_open`
//!   → `jobs::*`（定时触发业务动作，属调度层）

pub mod appdata_migrate;
pub mod db;
pub mod md_backup;
pub mod md_env;
pub mod md_file;
pub mod migrate;
pub mod notify;
pub mod plugin_fs;
pub mod portable_migrate;
pub mod portable_probe;
pub mod shell_open;

/* 桌面独占（V1-Android）：下面这些模块直接调 tauri 桌面专有 API ——
`WebviewWindowBuilder` 的 `transparent/skip_taskbar/always_on_top/decorations`、
`available_monitors()` / `primary_monitor()`、托盘菜单、注册表自启。
Android 上这些 API 要么不存在，要么无实现，**模块级**门控比逐行撒 `#[cfg]` 更省事，
也让移动端读代码时不会误以为「这里有实现、只是没调用」。 */
#[cfg(desktop)]
pub mod autostart;
#[cfg(desktop)]
pub mod geometry;
#[cfg(desktop)]
pub mod tray_menu;
#[cfg(desktop)]
pub mod window;
#[cfg(desktop)]
pub mod window_note;
#[cfg(desktop)]
pub mod window_rect;
#[cfg(desktop)]
pub mod window_spec;
