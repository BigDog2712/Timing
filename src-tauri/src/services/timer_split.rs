//! 跨零点分段（V0.11.3）。
//!
//! 用户口径：「跨零点分段记录」——一段 23:40 → 00:20 的会话，应该是昨天 23:40-24:00
//! 加今天 00:00-00:20 两条，各自出现在对应那天的日记里，而不是整条挂在昨天。
//!
//! ## 为什么在「结束时」拆，而不是在「导出时」裁
//!
//! 导出时裁剪只是渲染层的假象：库里仍是一条跨天记录。用户点开某一段改时间、在日记里
//! 删掉其中一天的行、或者两端各自导入，都会绕回同一条记录——「删了昨天，今天还留着」。
//! 落库时就拆开，后面的所有路径（列表 / 统计 / md 导出 / md 导入）都不必知道这件事。
//!
//! ## 累计秒数怎么分
//!
//! 按**墙钟占比**分。会话可能存在暂停，`accumulated_sec` 与墙钟跨度并不相等，按比例
//! 分只是近似；但它保证两件事：前后两段之和**恒等于**原累计（余数给后一段），
//! 以及「挂机过夜的会话不会把 8 小时全算进某一天」。真要精确到暂停点，得在每次
//! 暂停时也落一条分段——那会让暂停变成写库操作，得不偿失。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::record::TimeRecord;
use crate::platform::clock::day_bounds;
use crate::repositories::record_session as session;

/// 一段落在同一天之内的记录。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Segment {
    pub started_at: i64,
    pub ended_at: i64,
    pub accumulated_sec: i64,
}

/// 把 `[start_ms, end_ms)` 按**本地零点**切开；累计秒数按墙钟占比分配、总和守恒。
///
/// 不跨天时返回单段（调用方无需分支）。时间戳倒挂（`end <= start`）也返回单段，
/// 由上层原有的「无效时长」校验去拒绝，而不是在这里造出 0 长度的段。
pub fn split_by_day(start_ms: i64, end_ms: i64, accumulated_sec: i64) -> Vec<Segment> {
    let single = vec![Segment {
        started_at: start_ms,
        ended_at: end_ms,
        accumulated_sec,
    }];
    if end_ms <= start_ms {
        return single;
    }

    let total_wall = end_ms - start_ms;
    let mut segments: Vec<Segment> = Vec::new();
    let mut cursor = start_ms;
    let mut allocated: i64 = 0;

    loop {
        let (_, next_midnight) = bounds_of(cursor);
        /* `next_midnight <= cursor` 是时区异常时的自我保护：不能在这里空转。 */
        if next_midnight <= cursor || next_midnight >= end_ms {
            break;
        }
        let wall = next_midnight - cursor;
        let sec = accumulated_sec.saturating_mul(wall) / total_wall;
        segments.push(Segment {
            started_at: cursor,
            ended_at: next_midnight,
            accumulated_sec: sec,
        });
        allocated += sec;
        cursor = next_midnight;
    }

    segments.push(Segment {
        started_at: cursor,
        ended_at: end_ms,
        /* 余数归最后一段：整数除法只会少分，不会多分，所以这里恒 >= 0。 */
        accumulated_sec: accumulated_sec - allocated,
    });
    segments
}

/// `ms` 所在本地日的 `(当天 0 点, 次日 0 点)`；时间戳无效时退化为 `(ms, ms)`。
fn bounds_of(ms: i64) -> (i64, i64) {
    use chrono::{Local, TimeZone};
    match Local.timestamp_millis_opt(ms).earliest() {
        Some(dt) => day_bounds(dt.date_naive()),
        None => (ms, ms),
    }
}

/// 结束会话：跨天就拆成多条落库，不跨天等价于普通 `finalize`。
///
/// `ended_at` 由调用方给（倒计时到点用「计划结束时刻」，手动结束用「现在」）。
pub async fn finalize(
    pool: &SqlitePool,
    active: &TimeRecord,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
) -> AppResult<()> {
    let segments = split_by_day(active.started_at, ended_at, accumulated_sec);
    if segments.len() == 1 {
        return session::finalize(pool, active.id, accumulated_sec, ended_at, now).await;
    }
    crate::log_info!(
        "timer split across midnight: id={} into {} segments",
        active.id,
        segments.len()
    );
    let rows: Vec<(i64, i64, i64)> = segments
        .iter()
        .map(|s| (s.started_at, s.ended_at, s.accumulated_sec))
        .collect();
    session::finalize_split(pool, active, &rows, now).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::{Local, TimeZone};

    /** 某天本地 `h:m` 的毫秒时间戳（测试只在自己的时区里跑，不假设 UTC） */
    fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
        Local
            .with_ymd_and_hms(y, m, d, h, min, 0)
            .earliest()
            .expect("合法本地时刻")
            .timestamp_millis()
    }

    #[test]
    fn same_day_is_a_single_segment() {
        let start = at(2026, 11, 5, 9, 0);
        let end = at(2026, 11, 5, 10, 30);
        let segments = split_by_day(start, end, 5400);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].started_at, start);
        assert_eq!(segments[0].ended_at, end);
        assert_eq!(segments[0].accumulated_sec, 5400);
    }

    #[test]
    fn midnight_is_split_and_seconds_are_conserved() {
        let start = at(2026, 11, 5, 23, 40);
        let end = at(2026, 11, 6, 0, 20);
        let segments = split_by_day(start, end, 2400);

        assert_eq!(segments.len(), 2, "跨零点应拆成两段");
        assert_eq!(segments[0].started_at, start);
        assert_eq!(segments[0].ended_at, at(2026, 11, 6, 0, 0));
        assert_eq!(segments[1].started_at, at(2026, 11, 6, 0, 0));
        assert_eq!(segments[1].ended_at, end);

        /* 20 分钟在前、20 分钟在后 → 各 1200 秒 */
        assert_eq!(segments[0].accumulated_sec, 1200);
        assert_eq!(segments[1].accumulated_sec, 1200);
        let sum: i64 = segments.iter().map(|s| s.accumulated_sec).sum();
        assert_eq!(sum, 2400, "分段不得改变总时长");
    }

    #[test]
    fn multi_day_session_splits_per_day() {
        let start = at(2026, 11, 5, 22, 0);
        let end = at(2026, 11, 8, 2, 0);
        let segments = split_by_day(start, end, 1000);
        assert_eq!(segments.len(), 4, "5 日晚 / 6 日 / 7 日 / 8 日凌晨");
        let sum: i64 = segments.iter().map(|s| s.accumulated_sec).sum();
        assert_eq!(sum, 1000);
        /* 每段都不许跨天 */
        for segment in &segments {
            let a = Local.timestamp_millis_opt(segment.started_at).unwrap();
            let b = Local.timestamp_millis_opt(segment.ended_at).unwrap();
            assert!(b.date_naive() == a.date_naive() || b.time() == chrono::NaiveTime::MIN);
        }
    }

    #[test]
    fn zero_accumulated_stays_zero() {
        let start = at(2026, 11, 5, 23, 59);
        let end = at(2026, 11, 6, 0, 1);
        let segments = split_by_day(start, end, 0);
        assert!(segments.iter().all(|s| s.accumulated_sec == 0));
    }

    #[test]
    fn inverted_range_is_returned_as_is() {
        let start = at(2026, 11, 6, 0, 10);
        let end = at(2026, 11, 5, 23, 50);
        let segments = split_by_day(start, end, 5);
        assert_eq!(segments.len(), 1);
        assert_eq!(segments[0].accumulated_sec, 5);
    }
}
