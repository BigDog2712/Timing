//! 事件分段文件的类型定义（T01 仅类型）。
//!
//! ## 为什么 T01 只放类型
//!
//! 分段是**不可变文件** `sync/events/<device_id>/<seq>.jsonl`（架构设计 §1.2）：
//! 每轮把本机新增事件写进一个「只写一次、永不修改」的新文件。命名、JSONL 读写、
//! 游标推进都是纯函数为主，属于 T02 的 `segment.rs` 实现体；T01 只把形状定下来，
//! 让 [`repository`](super::repository) 与后续编排能引用同一份类型而不发明第二套。

/// 分段序号宽度：`00000001`…（8 位零填充，本机单调递增）。
pub const SEGMENT_SEQ_WIDTH: usize = 8;

/// 一个事件分段的稳定标识：属于哪台设备、第几段。
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct SegmentId {
    /// 产生这批事件的设备 id（12 位小写 hex）。
    pub device_id: String,
    /// 分段序号（8 位零填充的**源数值**，落盘时才补零）。
    pub seq: u32,
}

/// 一个事件分段文件（只写一次、永不修改）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentFile {
    /// 分段标识。
    pub id: SegmentId,
    /// 远端相对路径 `sync/events/<device_id>/<seq>.jsonl`（由 T02 的命名函数生成）。
    pub path: String,
}
