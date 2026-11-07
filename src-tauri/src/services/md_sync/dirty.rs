//! 业务写入信号（V0.11.19 批 1，设计 §4.6）：**白名单，不是黑名单**。
//!
//! 唯一信号源是命令层：25 条业务命令在写库成功后打一次标记。后台路径一律不打：
//! - `jobs/flusher.rs` 每 15s 的 `flush_active` 是心跳，不是业务变更；
//! - 服务层内部的云端记账、水位、pending、`settings` 业务键都不影响 md 内容。
//!
//! 若把心跳算进来，脏标记**永远为真**，秒级写 md 会退化成「每 15 秒一次无意义写盘 +
//! 每 15 秒一份备份」（`md_backup` 每次写盘留底一份）。白名单的好处是：漏标一条业务命令，
//! 最坏由 60 秒兜底吸收（1.5s 变 60s，**不丢数据**）；黑名单漏排除一条后台写，则是全天
//! 持续写盘，且没有任何门禁会报警。
//!
//! ## 为什么是两个原子量而不是一个 bool
//!
//! `SEQ` 是单调序号，表达「还欠一轮」这个**状态**：md 链抢不到闸时故意不动它，
//! 200ms 后下一圈自然还会看到「SEQ 比我见过的那份新」。消息/通知会丢，状态不会。
//! `LAST_WRITE_MS` 是墙钟，给云端智能档判「停手 5 分钟」用，两者用途不同不能合并。
//!
//! ## 写序
//!
//! `LAST_REASON` → `LAST_WRITE_MS` → `SEQ`。反过来（先加 SEQ）会让观察线程在
//! 「序号已变、时间还是上一次」的窗口里拿旧时间戳算出「去抖已到」，提前跑一轮。

use std::sync::atomic::{AtomicI64, AtomicU64, AtomicU8, Ordering};

use crate::platform::clock::now_ms;

static LAST_WRITE_MS: AtomicI64 = AtomicI64::new(0);
static SEQ: AtomicU64 = AtomicU64::new(0);
static LAST_REASON: AtomicU8 = AtomicU8::new(0);

/// 日志里的五种业务来源（§11.3 `md sync wake: reason=...`）。
/// `file` / `fallback` 由 job 自己产生，不走命令层，所以不在这张表里。
const REASONS: [&str; 5] = ["timer", "todo", "note", "item", "record"];

fn code_of(reason: &str) -> u8 {
    match reason {
        "timer" => 0,
        "todo" => 1,
        "note" => 2,
        "item" => 3,
        /* `record` 与未知值都归到记录域：恢复备份（`md_backup_restore`）写的也是
           `time_records` / `todos` / `notes`，用记录域的口径不会撒谎。 */
        _ => 4,
    }
}

/// 一次业务写入成功之后调用。**只在 `commands/` 下调用**，`jobs/` 下一次都不许有。
pub fn mark(reason: &'static str) {
    LAST_REASON.store(code_of(reason), Ordering::SeqCst);
    LAST_WRITE_MS.store(now_ms(), Ordering::SeqCst);
    SEQ.fetch_add(1, Ordering::SeqCst);
}

/// 单调序号。job 用它判「有没有新改动」；抢不到闸时不要推进自己见过的那份。
pub fn seq() -> u64 {
    SEQ.load(Ordering::SeqCst)
}

/// 最后一次业务写入的墙钟毫秒（0 = 进程启动以来一次业务写都没有）。
pub fn last_write_ms() -> i64 {
    LAST_WRITE_MS.load(Ordering::SeqCst)
}

/// 最后一次业务写入的来源，只进日志。
pub fn last_reason() -> &'static str {
    let code = usize::from(LAST_REASON.load(Ordering::SeqCst));
    REASONS.get(code).copied().unwrap_or("record")
}

#[cfg(test)]
mod tests {
    use std::sync::{Mutex, MutexGuard};

    use super::{last_reason, last_write_ms, mark, seq};

    /* 这两条用例读写的是进程级全局原子量（SEQ / LAST_REASON），而 cargo test 默认把
       同一模块内的用例放到多线程并行跑。不加锁时 A 的 `mark → assert` 之间会插进 B 的
       `mark`，偶发出现「序号 +3」或「reason 串台」的红。生产代码是刻意的全局单例，
       语义不能改，只在测试侧串行化这两段；持锁跨整个「写 + 读」序列才有效。 */
    static GLOBAL_STATE_LOCK: Mutex<()> = Mutex::new(());

    fn lock() -> MutexGuard<'static, ()> {
        GLOBAL_STATE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
    }

    #[test]
    fn every_mark_advances_the_monotonic_sequence() {
        let _guard = lock();
        let before = seq();
        mark("timer");
        mark("todo");
        assert_eq!(seq(), before + 2, "序号必须单调，不能用 bool 代替");
        assert!(last_write_ms() > 0, "打标记要同时记下墙钟");
        assert_eq!(last_reason(), "todo");
    }

    #[test]
    fn reason_codes_stay_within_the_log_vocabulary() {
        let _guard = lock();
        for (reason, expected) in [
            ("timer", "timer"),
            ("todo", "todo"),
            ("note", "note"),
            ("item", "item"),
            ("record", "record"),
        ] {
            mark(reason);
            assert_eq!(last_reason(), expected);
        }
    }
}
