//! 平台叶子层：不依赖任何业务模块，上层（infra / services / app / jobs）都可依赖它。
//!
//! 这一层是**依赖图的最底部**：`platform` 只允许用 std 与 chrono
//! （`app_dir` 例外，它需要 `dirs` 才能算出 `%APPDATA%`——与 Tauri 同源，见 ADR-050 §2）。
//! 之所以独立出来，是为了打断 `infra ↔ services` 的环——`clock` 被 services 使用，
//! 又不需要任何 Tauri 能力，放在 infra 里会让「infra 可整体替换」这个前提失效。

pub mod app_dir;
pub mod boot_timing;
pub mod clock;
pub mod duration;
pub mod host;
pub mod log;
