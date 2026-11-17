//! 同步事件流（`sync_stream`）：计时事件的跨端增量传输。
//!
//! ## 这一层在重构里的位置
//!
//! 计时从「全天 md 快照」切到「不可变分段 JSONL」的增量事件（架构设计 §1.2）：
//! - 上传（[`push_new_events`]）：把本机新增 `timer_ops` 写进 `sync/events/<device_id>/<seq>.jsonl`；
//! - 下载（[`pull_segments`]）：读「序号 > 我的游标」的分段，uid 唯一索引 upsert 去重后折叠；
//! - 折叠（[`apply::apply_and_fold`]）：复用 `fold_session`，把事件物化回 `time_records`。
//!
//! 游标与待确认批次按 `(scope, device_id)` 隔离，scope 来自实际传输目标；旧的无目标账本不作确认依据。
//!
//! ## 为什么下载用 GET 顺号探测而不是 LIST 分段
//!
//! 分段 seq 是**稠密单调**的（本机每轮写 `last_seq+1`），所以「读 `seq > 游标` 的分段」
//! 可以退化成「GET `<seq>.jsonl`，404 即追平」，不必对 `sync/events/<device>/` 发 PROPFIND。
//! 只有**发现对端设备**（列 `sync/events/` 的直接子目录）才发一次 depth-1 PROPFIND，
//! 而那个目录数量 = 设备数（个位数），远在坚果云 750 条上限之内。

pub mod apply;
pub mod progress;
pub mod pull;
pub mod push;
pub mod repository;
mod recover_cursor;
pub mod scope;
pub mod segment;
pub mod transport;

pub use progress::progress;
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
    /// **可见但不构成失败**的异常：本轮照常同步，只是有需要人看一眼的东西。
    ///
    /// 与 `errors` 分开是 0.12.11 真机逼出来的：`round_stream::run` 拿「`errors` 是否为空」
    /// 判整轮成败，一个与同步无关的远端条目（坚果云在 `sync/events/` 下稳定返回的
    /// `unix-directory`）就让每轮都判失败并触发退避，退避时间一路翻倍，同步几乎跑不动。
    pub warnings: Vec<String>,
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
#[cfg(test)]
mod tests_targets;
#[cfg(test)]
mod tests_target_upgrade;
#[cfg(test)]
mod tests_target_webdav;
#[cfg(test)]
mod tests_target_recovery;
#[cfg(test)]
mod tests_open_session;
#[cfg(all(test, desktop))]
mod tests_record_revision;
