//! 计时时间口径（纯函数，无 IO）。
//!
//! 从 `services/timer.rs` 拆出（单文件 ≤300 行，ADR-017）。这里是**全项目唯一的
//! 时长计算实现**：Rust 的 state / 倒计时判定 / 周期落盘都调它；前端 `computeLiveSec`
//! 是它的镜像，两者由 `tests/fixtures/timer-formula.json` 的黄金用例锁死（R8）。
//!
//! 时钟选择见 `platform::clock`：
//! - 有匹配锚点 → 用单调时钟的流逝（不受 NTP / 改时影响）；
//! - 无锚点（进程重启 / 测试构造）→ 退回墙钟差值，行为与 v0.2 一致。

use crate::models::record::TimeRecord;
use crate::platform::clock;

/// 自 `running_since` 以来的流逝毫秒。
pub(crate) fn elapsed_ms(running_since: i64, now: i64) -> i64 {
    clock::anchored_elapsed_ms(running_since).unwrap_or_else(|| now.saturating_sub(running_since))
}

/// 向下取整为秒；负差值（时钟回拨）按 0（前端 computeLiveSec 同规则）。
pub(crate) fn floor_sec(delta_ms: i64) -> i64 {
    if delta_ms <= 0 {
        0
    } else {
        delta_ms / 1000
    }
}

/// 实时累计秒 = 已累计 + 当前段流逝。
pub(crate) fn live_duration(record: &TimeRecord, now: i64) -> i64 {
    match record.running_since {
        Some(running_since) => record.accumulated_sec + floor_sec(elapsed_ms(running_since, now)),
        None => record.accumulated_sec,
    }
}

/// 「退出期间」可并入的秒数（V0.4.2，崩溃恢复的可选补时）。
///
/// 口径三前提：`include` 为真、当时**正在跑**（`running_since` 非空）、`until` 晚于它。
/// 暂停中的会话没有流逝，补了等于把暂停时间算成工作；墙钟回拨不许倒扣（`floor_sec` 兜底）。
///
/// 这里用**墙钟**差值，刻意不走 `elapsed_ms`：这段空档恰恰是进程不在的那段时间，
/// 单调锚点要么不存在（重启后），要么只覆盖重启之后——盯它反而算错。
pub(crate) fn gap_sec(record: &TimeRecord, until: i64, include: bool) -> i64 {
    if !include {
        return 0;
    }
    match record.running_since {
        Some(since) => floor_sec(until.saturating_sub(since)),
        None => 0,
    }
}
