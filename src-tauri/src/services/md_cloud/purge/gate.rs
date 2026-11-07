//! 两路**唯一共享**的纯判定（无 IO）：严格日期名 + 保留窗口（设计 §3.1.1 / §8.2）。
//!
//! 键名不在这里（在 `models/md_cloud_purge.rs`），候选集判定也不在这里
//! （在 `webdav.rs` / `folder.rs`，彼此不调用）。本文件只回答两个问题：
//! 「这个文件名是不是严格的 `yyyy-MM-dd.md`」与「这个日期过没过保留窗口」。
//!
//! 不引 `regex` crate：字符级判定就够，且 15 行能一眼看完。
//!
//! 形状边界的断言放在两路候选集各自的 `#[cfg(test)]` 里，通过候选集这个真实入口
//! 来测，而不是在本文件直呼函数名：`grep -rn` 全库命中数必须是 3（本文件 1 处
//! 定义 + 两路各 1 处调用），多一处都算「日期名解析出现了第二份」。

use chrono::{Duration, NaiveDate};

/// 严格 `^\d{4}-\d{2}-\d{2}\.md$`（补零、四位年、真实日历日期）。
///
/// 全库**唯一**一份日期名解析实现。两路候选集都调它，于是「同一套日期正则只许有
/// 一份」不需要靠注释约定，而是靠 `grep` 数：1 处定义 + 2 处调用。
pub(crate) fn parse_strict_date_file(name: &str) -> Option<NaiveDate> {
    let stem = name.strip_suffix(".md")?;
    let bytes = stem.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' {
        return None;
    }
    if !bytes
        .iter()
        .enumerate()
        .all(|(idx, byte)| matches!(idx, 4 | 7) || byte.is_ascii_digit())
    {
        return None;
    }
    /* 逐字比「四位年-两位月-两位日」还不够：`2026-13-45` 形状对但不是日期。
       用 chrono 的日历校验收口，顺便拒绝 2 月 30 日。 */
    NaiveDate::parse_from_str(stem, "%Y-%m-%d").ok()
}

/// `date < today - keep_days`。`keep_days = 0` 就是「只留今天」。
///
/// 这一条同时承担「排除今天与未来」，并且**必须早于比水位**（PRD §2.4 不变量 1）：
/// 水位是持久状态，可能被别的设备写脏、被手工改成未来日期；先比水位，今天那份
/// 就有机会进候选，而它是唯一还在被读写的那一份。
pub(crate) fn past_keep_window(date: NaiveDate, today: NaiveDate, keep_days: i64) -> bool {
    date < today - Duration::days(keep_days)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn day(value: &str) -> NaiveDate {
        NaiveDate::parse_from_str(value, "%Y-%m-%d").expect("测试日期")
    }

    #[test]
    fn keep_window_excludes_today_and_future_before_any_watermark() {
        let today = day("2026-11-07");
        assert!(past_keep_window(day("2026-11-04"), today, 0));
        assert!(!past_keep_window(today, today, 0), "今天永远不删");
        assert!(!past_keep_window(day("2099-01-01"), today, 0), "未来不删");
        assert!(!past_keep_window(day("2026-11-06"), today, 1));
        assert!(past_keep_window(day("2026-11-05"), today, 1));
    }

    #[test]
    fn keep_window_is_anchored_on_local_today_not_utc() {
        /* 传进来的 `today` 由 `md_cloud::today()`（`chrono::Local`）算好；这里只证明
           窗口是「相对于入参」而不是自己再取一次时钟，避免晚上 8 点跨日。 */
        let today = day("2026-01-01");
        assert!(past_keep_window(day("2025-12-31"), today, 0));
        assert!(!past_keep_window(day("2026-01-01"), today, 0));
    }
}
