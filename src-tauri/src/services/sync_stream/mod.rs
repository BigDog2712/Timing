//! 同步事件流（`sync_stream`）：计时事件的跨端增量传输。
//!
//! ## 这一层在重构里的位置
//!
//! 计时从「全天 md 快照」切到「不可变分段 JSONL」的增量事件（架构设计 §1.2）：
//! - 上传：把本机新增 `timer_ops` 写进 `sync/events/<device_id>/<seq>.jsonl`；
//! - 下载：读「序号 > 我的游标」的分段，uid 唯一索引 upsert 去重后交给 `fold_session`；
//! - 游标：`sync_event_cursor` 表记录「从每台对端设备读到哪」。
//!
//! ## 分文件理由（T01）
//!
//! - [`repository`]：`sync_event_cursor` 表的 SQL 原语（增查改），只碰 SQL；
//! - [`segment`]：事件分段文件的类型定义（T01 仅类型）；
//! - 本文件的**编排**（`push_new_events` / `pull_segments` / `apply_and_fold`）在 T02 落地，
//!   T01 只声明子模块，让 [`repository`] / [`segment`] 能随 `cargo test --lib` 一起编译验证。

pub mod repository;
pub mod segment;
