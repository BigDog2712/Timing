//! 同步事件流（`sync_stream`）：计时事件的跨端增量传输。
//!
//! ## 这一层在重构里的位置
//!
//! 计时从「全天 md 快照」切到「不可变分段 JSONL」的增量事件（架构设计 §1.2）：
//! - 上传（[`push_new_events`]）：把本机新增 `timer_ops` 写进 `sync/events/<device_id>/<seq>.jsonl`；
//! - 下载（[`pull_segments`]）：读「序号 > 我的游标」的分段，uid 唯一索引 upsert 去重后折叠；
//! - 折叠（[`apply::apply_and_fold`]）：复用 `fold_session`，把事件物化回 `time_records`。
//!
//! ## 双游标共用一张 `sync_event_cursor`
//!
//! 架构 §1.2 说「两张游标」：上传游标（本机 `op_id` 已传上界）与下载游标（从对端读到哪）。
//! T01 只建了一张 `sync_event_cursor(device_id PK, last_op_id, last_seq)`。这里**复用同一张表**，
//! 用 key 区分方向：
//!
//! - key = **本机** device_id → 上传游标（`last_op_id`=本机已传最大 op_id，`last_seq`=本机最后分段号）；
//! - key = **对端** device_id → 下载游标（`last_op_id`=对端已读最大 op_id，`last_seq`=对端最后分段号）。
//!
//! `device_id` 是 12 位小写 hex、全局唯一，本机与任何对端都不会撞 key，所以一张表两用
//! 不会串。这样避免了为上传游标再开一张表（T01 已把表建好，直接可用）。
//!
//! ## 为什么下载用 GET 顺号探测而不是 LIST 分段
//!
//! 分段 seq 是**稠密单调**的（本机每轮写 `last_seq+1`），所以「读 `seq > 游标` 的分段」
//! 可以退化成「GET `<seq>.jsonl`，404 即追平」，不必对 `sync/events/<device>/` 发 PROPFIND。
//! 只有**发现对端设备**（列 `sync/events/` 的直接子目录）才发一次 depth-1 PROPFIND，
//! 而那个目录数量 = 设备数（个位数），远在坚果云 750 条上限之内。

pub mod apply;
pub mod pull;
pub mod push;
pub mod repository;
pub mod segment;
pub mod transport;

pub use pull::pull_segments;
pub use push::push_new_events;

/// 上传一轮的结果。
#[derive(Debug, Default)]
pub struct PushSummary {
    /// 本轮写出的分段序号（0 = 没有新事件可传）。
    pub segment_seq: u32,
    /// 本轮上传的事件数。
    pub events: usize,
    /// 本轮上传的字节数（JSONL 长度）。
    pub bytes: usize,
    /// 传输层失败（不折 `AppError`，交给 `report.errors`）。
    pub errors: Vec<String>,
}

/// 下载一轮的结果。
#[derive(Debug, Default)]
pub struct PullSummary {
    /// 发现的对端设备数。
    pub peers: usize,
    /// 读到的分段数。
    pub segments: usize,
    /// 解析出的事件数。
    pub events: usize,
    /// 新插入本地的事件数（uid 去重后）。
    pub applied: usize,
    /// 传输层失败。
    pub errors: Vec<String>,
}

/// 折叠 + 物化一轮的结果。
#[derive(Debug, Default)]
pub struct FoldOutcome {
    /// 新插入的事件数（uid 去重后）。
    pub applied: usize,
    /// 折叠过的会话数。
    pub sessions: usize,
    /// 物化（UPDATE / INSERT）的 `time_records` 行数。
    pub materialized: usize,
    /// 被 drop 掉（软删）的会话数。
    pub dropped: usize,
    /// `fold_session` 忽略的事件数。
    pub ignored: usize,
}

#[cfg(test)]
mod tests;
#[cfg(test)]
mod tests_integrity;
