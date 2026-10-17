//! 后端测试入口（QA 新增，仅 `cargo test` 编入）。
//!
//! 断言来源：`docs/Spec-v1.md` §6 / §9 与 `docs/phase2/IPC-CONTRACT-v2.md`，
//! 以行为（输入→可观测输出/错误码）为准，不绑定实现内部细节。

mod support;

mod countdown;
mod item;
mod item_batch2;
mod migration;
mod migration_v2;
mod note;
mod record;
mod reminder;
mod theme;
mod timer;
mod timer_switch;
mod todo;
mod tray_batch2;
mod tray_menu;
mod window_geometry;
mod window_spec;
