//! `set_bound_process_watch` 的入参形状（[0.13] 进程退出结束自动接管段）。
//!
//! 放 `models/` 而不是命令文件里：这条命令有**移动端桩**（`commands/
//! bound_process_watch_cmd_mobile.rs`），DTO 在 `models/` 两端才都拿得到 —— 与
//! `models::foreground` 同一个理由。
//!
//! ## 为什么是「段」而不只是「事项」
//!
//! 自动接管与用户手动开始，在库里完全同形（`time_records` 没有来源列），所以
//! 「该不该停」只能靠**运行时注册的那一段**来判断。`segment_started_at` 取
//! `time_records.started_at`：`uq_records_open` 保证全局最多一条 active，暂停/继续
//! 不改这个值（同一段），`switch` 的 `end_and_start` 会开出一条新段。
//! 详见 `services::bound_process_watch` 的模块头。

use serde::Deserialize;

/// 一次「盯住这个进程，它退出就结束这一段」的注册。
///
/// `deny_unknown_fields`：字段名漂了要**当场报错**，而不是静默按缺省处理 ——
/// 静默的后果是「注册了一个 processId=0 的假目标」，退出检测永远不触发，零日志。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BoundProcessWatchInput {
    /// 这一段归哪个事项。与 `segmentStartedAt` 一起构成段的身份。
    pub item_id: i64,
    /// 前台窗口的进程号（`ForegroundWindow.process_id`）。`0` 由命令层拒绝。
    pub process_id: u32,
    /// 段起点 = `time_records.started_at`（epoch ms）。
    pub segment_started_at: i64,
}
