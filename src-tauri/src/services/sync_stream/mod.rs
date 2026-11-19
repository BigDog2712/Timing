//! 同步事件流（`sync_stream`）：计时事件的跨端增量传输。
//!
//! ## 这一层在重构里的位置
//!
//! 计时从「全天 md 快照」切到「不可变分段 JSONL」的增量事件（架构设计 §1.2）：
//! - 上传（[`push_new_events`]）：本机事件只写 `sync/streams/<device_id>/<目标指纹>/<seq>.jsonl`；
//! - 下载（[`pull_segments`]）：读「序号 > 我的游标」的分段，uid 唯一索引 upsert 去重后折叠；
//! - 折叠（[`apply::apply_and_fold`]）：复用 `fold_session`，把事件物化回 `time_records`。
//!
//! 新上传账本与旧账本隔离；下载账本同时区分接收目标和源写入流，复制过来的流不共享游标。
//! 旧 `sync/events` 只读不写，升级后从本机事件补传新流；旧客户端需升级才能读取新流。
//!
//! 每条流独立按稠密序号 GET，缺号即停、下轮续读；PROPFIND 仅发现设备与写入流，不枚举分段。

pub mod apply;
pub mod progress;
pub mod pull;
pub mod push;
mod recover_cursor;
pub mod repository;
pub mod scope;
pub mod segment;
pub mod streams;
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
mod tests_open_session;
#[cfg(all(test, desktop))]
mod tests_record_revision;
#[cfg(test)]
mod tests_shared_directory;
#[cfg(test)]
mod tests_shared_upgrade;
#[cfg(test)]
mod tests_target_recovery;
#[cfg(test)]
mod tests_target_upgrade;
#[cfg(test)]
mod tests_target_webdav;
#[cfg(test)]
mod tests_targets;
