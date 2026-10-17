//! 基础设施层：SQLite、托盘、窗口、自启、快捷键（[P1]）、事件、后台落盘。

pub mod autostart;
pub mod clock;
pub mod countdown;
pub mod db;
pub mod events;
pub mod geometry;
pub mod migrate;
pub mod monitor;
pub mod note_windows;
pub mod notify;
pub mod reminder;
pub mod runtime;
pub mod setup;
pub mod shortcuts;
pub mod tray;
pub mod tray_menu;
pub mod window;
pub mod window_spec;
