//! AI 服务（OpenAI 兼容协议）。
//!
//! 四块：`config`（配置 + 密钥视图）、`client`（`async-openai` 传输）、
//! `prompt`（提示词与输出解析）、`suggest` / `daily`（两条业务入口）。
//!
//! **桌面独占**：`async-openai` 只在桌面依赖段，且今日汇总要读分析窗的活动库
//! （`app::activity_bridge` 本身 `#[cfg(desktop)]`）。手机端命令是桩
//! （`commands/ai_cmd_mobile.rs`），不引入第二棵 HTTP 依赖树。

pub mod client;
pub mod config;
pub mod daily;
mod error_mapping;
pub mod prompt;
pub mod suggest;
