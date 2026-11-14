//! 多端同步（P4）的代码落点。
//!
//! ## 为什么在 `data/sync/` 而不是 `infra/`
//!
//! L4 规定 `infra` 不得依赖 `services`；而同步要读 `sessions` / `time_records` 这些
//! 业务表，也要用 `data/remote_backup` 那套凭据。`data/remote_backup.rs` 已有
//! 「data 调 infra::insight::webdav」的先例，这里沿用同一个方向。
//!
//! ## 本文件在 T11 阶段只有骨架
//!
//! T11 = 簿记层（`updated_at_ms` 盖戳、墓碑、四张同步表）。真正的合并内核（`jsonl` /
//! `dayfile` / `merge` / `plan` / `state` / `bundle`）是 T12，传输层是 T13。
//! 这里先落**被 T12/T13 共用、且现在就能钉住**的那一个纯函数与一个裁决常量，
//! 免得 T12 开工时又要回头改 `data/mod.rs`。
//!
//! ## 一条不变量（P4 全部设计的支点）
//!
//! `uid` 里含属主 `device_id`（`s:<device>:<id>`）⇒ **一行永远只有它的属主写**。
//! 所以同步不需要服务端 seq、不需要冲突解决：唯一的「同 uid 两次写」是属主自己重传，
//! 用 `updated_at_ms` 单行 LWW 就够。这条不成立时整个 P4 方案都要推翻重来。

/// 墓碑里 `sessions` 的类别。
pub const TOMBSTONE_KIND_SESSION: &str = "s";

/// 墓碑里 `time_records` 的类别。
pub const TOMBSTONE_KIND_TIME_RECORD: &str = "t";

/// 本轮是否把 `time_records` 也编进分片。
///
/// **本轮 `false`**（已裁决）：`items` 不过桥 ⇒ `item_id` 在另一端是悬空外键，
/// 导出可穿戴的计时记录只会造出「指向不存在事项」的行。
/// 列与触发器**已经建好**（业务库 0010），打开这个开关不需要再动 schema——
/// 这正是「先落列后接写入方」的理由。
pub const INCLUDE_TIME_RECORDS: bool = false;

/// 把毫秒时间戳折成**本地**日键 `YYYY-MM-DD`。
///
/// 实现已搬到 `services::identity::local_day_key`（跨平台：业务库侧写 `timer_ops.day_key`
/// 也要它，而 `insight` 整块是 `#[cfg(desktop)]`）。这里转发，调用点写法不变。
///
/// 三条口径必须与既有实现一致，否则分片会与 md 同步、`app_usage.local_date` 错开一天：
/// 1. **本地时区**，不是 UTC（UTC 切会整档偏一天，坑速览 §9.8 的同一个形状）；
/// 2. 日界是本地 00:00，由 `infra::insight::clock::local_day_range_at` 给出；
/// 3. 返回 `Result` 而不是 `unwrap_or_default()`：越界的毫秒值宁可报错，
///    也不要折成 `1970-01-01` —— 那会把「一条坏行」变成「一整天的历史」。
#[cfg(test)]
mod local_day_key_tests {
    use crate::services::identity::local_day_key;

    /// 日键必须是 10 位、连字符位置固定 —— 它是 `activity_daily_totals.day_key`
    /// 的 `CHECK(length(day_key) = 10)` 与远端文件名 `day-YYYY-MM-DD.jsonl` 的共同前提。
    #[test]
    fn day_key_is_canonical() {
        let key = local_day_key(1_700_000_000_000).expect("2023-11-14 in local time");
        assert_eq!(key.len(), 10, "{key}");
        assert_eq!(&key[4..5], "-");
        assert_eq!(&key[7..8], "-");
        assert!(key.chars().filter(char::is_ascii_digit).count() == 8, "{key}");
    }

    /// 跨本地日界前后必须落在不同的天（用 `local_day_range_at` 反查，避免写死时区）。
    #[test]
    fn day_key_flips_at_the_local_midnight() {
        let at = 1_700_000_000_000;
        let (day_start_ms, _) = crate::infra::insight::clock::local_day_range_at(at).expect("range");
        let before = local_day_key(day_start_ms - 1).expect("previous day");
        let on = local_day_key(day_start_ms).expect("day start");
        assert_ne!(before, on, "local midnight must start a new day key");
        assert_eq!(on, local_day_key(at).expect("same day"));
    }

    /// 越界毫秒必须报错，不许折成 1970（那会把一条坏行变成一整天的历史）。
    #[test]
    fn out_of_range_is_an_error() {
        assert!(local_day_key(i64::MAX).is_err());
    }
}
