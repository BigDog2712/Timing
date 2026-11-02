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

pub mod autostart;
pub mod db;
pub mod geometry;
pub mod md_backup;
pub mod md_file;
pub mod migrate;
pub mod notify;
pub mod plugin_fs;
pub mod tray_menu;
pub mod window;
pub mod window_note;
pub mod window_rect;
pub mod window_spec;
