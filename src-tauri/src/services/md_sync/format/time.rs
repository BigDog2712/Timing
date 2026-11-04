//! 时间格式化 / 宽松解析 / 本地日界（从 `format.rs` 拆出）。

use chrono::{Datelike, Local, NaiveDate, NaiveDateTime, TimeZone};

pub fn format_ts(ms: i64) -> String {
    match Local.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%Y-%m-%d %H:%M:%S").to_string(),
        None => String::new(),
    }
}

/// 宽松解析：`%Y-%m-%d %H:%M:%S` / `%Y-%m-%d %H:%M` / `%Y/%m/%d %H:%M:%S`。
pub fn parse_ts(raw: &str) -> Option<i64> {
    let value = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() {
        return None;
    }
    for format in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y/%m/%d %H:%M:%S"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, format) {
            if let Some(dt) = Local.from_local_datetime(&naive).earliest() {
                return Some(dt.timestamp_millis());
            }
        }
    }
    None
}

/// 向下对齐到整分钟。
///
/// 进行中的段用它做 `end`：轮询每 2 秒一轮，秒级 `end` 会让同一篇日记每天被重写
/// 上万次（Obsidian 不停重载、OneDrive 反复上传）；对齐到分钟后同一分钟内文本不变，
/// 写盘判定自然为「无变化」。用 `div_euclid` 而不是 `%`，负时间戳也按「向下」处理。
pub fn floor_to_minute(ms: i64) -> i64 {
    const MINUTE_MS: i64 = 60_000;
    ms.div_euclid(MINUTE_MS) * MINUTE_MS
}

/// 把秒数渲染成人读的时长（`1h34m20s` / `46m06s` / `45s`）。
///
/// 只用于 Markdown 里的 `duration:` 行：Planner 忽略未知键，这一行纯粹给人看，
/// **不参与任何时间计算**——真实口径始终是数据库的 `accumulated_sec`。
pub fn format_duration(sec: i64) -> String {
    let total = sec.max(0);
    let (hours, minutes, seconds) = (total / 3600, (total % 3600) / 60, total % 60);
    let mut out = String::new();
    if hours > 0 {
        out.push_str(&format!("{hours}h"));
    }
    if minutes > 0 || hours > 0 {
        out.push_str(&format!("{minutes:02}m"));
    }
    if seconds > 0 || out.is_empty() {
        if out.is_empty() {
            out.push_str(&format!("{seconds}s"));
        } else {
            out.push_str(&format!("{seconds:02}s"));
        }
    }
    out
}

/// `format_duration` 的逆：认 `1h34m20s` / `46m06s` / `45s`，也认纯数字（按秒）。
///
/// 宽松是对的：这一行是派生展示值，用户手改成什么形态都不该让整段解析失败。
/// 认不出来返回 `None`，渲染时就不写这一行（不会污染 `(start, end)` 这个事实）。
pub fn parse_duration(raw: &str) -> Option<i64> {
    let value = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() {
        return None;
    }
    if let Ok(sec) = value.parse::<i64>() {
        return Some(sec.max(0));
    }
    let mut total = 0i64;
    let mut digits = String::new();
    let mut units = 0usize;
    for ch in value.chars() {
        if ch.is_ascii_digit() {
            digits.push(ch);
            continue;
        }
        let factor = match ch.to_ascii_lowercase() {
            'h' => 3600,
            'm' => 60,
            's' => 1,
            _ => return None,
        };
        let count: i64 = digits.parse().ok()?;
        digits.clear();
        total = total.saturating_add(count.saturating_mul(factor));
        units += 1;
    }
    if !digits.is_empty() || units == 0 {
        return None;
    }
    Some(total)
}

/// `2026-10-21 09:00`（分钟粒度）。
///
/// 待办的 `planned_at` 用它：计划到几点几分有意义，秒没有。渲染成 `YYYY-MM-DD HH:MM`
/// 而不是带年份缩写，是因为日记要能跨年读——今年 12 月写的「01-05」，明年回看时
/// 不该被理解成今年的 1 月 5 日。
pub fn format_minute(ms: i64) -> String {
    match Local.timestamp_millis_opt(ms).single() {
        Some(dt) => dt.format("%Y-%m-%d %H:%M").to_string(),
        None => String::new(),
    }
}

/// 宽松解析「计划时间」：`2026-10-21 09:00` / `2026-10-21` / `10-21 09:00` / `10-21`。
///
/// 缺年份时按 `today` 的年份补。补完若比今天早超过半年，按**跨年预约**处理、进到明年
/// ——12 月 20 日写 `01-05`，人想表达的显然是明年 1 月 5 日，而不是已经过去的今年 1 月。
///
/// 认不出来返回 `None`：调用方据此认定「这不是计划时间，是标题的一部分」，不会误剥。
pub fn parse_planned(raw: &str, today: NaiveDate) -> Option<i64> {
    let value = raw.trim().trim_matches('"').trim_matches('\'').trim();
    if value.is_empty() {
        return None;
    }
    /* 完整日期 / 日期时间先走本地解析（含 `/` 分隔、带秒的形态）。 */
    if let Some(naive) = parse_local_naive(value) {
        return to_ms(naive).map(floor_to_minute);
    }
    /* 缺年份：补上今天所在年份再解析一次（`10-21` → `2026-10-21`）。 */
    let padded = format!("{}-{value}", today.format("%Y"));
    let naive = parse_local_naive(&padded)?;
    let ms = to_ms(naive)?;
    /* 半年前的日期 = 用户写的是明年（12 月写 `01-05` 不是指已经过去的今年 1 月）。 */
    let (today_start, _) = day_bounds(today);
    Some(if ms < today_start - 183 * 86_400_000 {
        shift_year(naive)
            .and_then(to_ms)
            .map(floor_to_minute)
            .unwrap_or(ms)
    } else {
        ms
    })
}

/// 认 `YYYY-MM-DD[ HH:MM[:SS]]`（`/` 也认）；只有日期时补 00:00。
fn parse_local_naive(value: &str) -> Option<NaiveDateTime> {
    for format in ["%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M"] {
        if let Ok(naive) = NaiveDateTime::parse_from_str(value, format) {
            return Some(naive);
        }
    }
    for format in ["%Y-%m-%d", "%Y/%m/%d"] {
        if let Ok(date) = NaiveDate::parse_from_str(value, format) {
            return date.and_hms_opt(0, 0, 0);
        }
    }
    None
}

fn to_ms(naive: NaiveDateTime) -> Option<i64> {
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map(|dt| dt.timestamp_millis())
}

/// 往后挪一年（2 月 29 日退到 28 日）。
fn shift_year(naive: NaiveDateTime) -> Option<NaiveDateTime> {
    let date = naive.date();
    let next = NaiveDate::from_ymd_opt(date.year() + 1, date.month(), date.day())
        .or_else(|| NaiveDate::from_ymd_opt(date.year() + 1, date.month(), 28))?;
    Some(next.and_time(naive.time()))
}

/// 本地日界：`[当天 00:00, 次日 00:00)`。
pub fn day_bounds(date: NaiveDate) -> (i64, i64) {
    let start = date.and_hms_opt(0, 0, 0).expect("合法日期");
    let next = date
        .succ_opt()
        .unwrap_or(date)
        .and_hms_opt(0, 0, 0)
        .expect("合法日期");
    let to_ms = |naive| {
        Local
            .from_local_datetime(&naive)
            .earliest()
            .map(|dt| dt.timestamp_millis())
            .unwrap_or(0)
    };
    (to_ms(start), to_ms(next))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn day_bounds_cover_the_whole_local_day() {
        let date = NaiveDate::from_ymd_opt(2026, 10, 20).unwrap();
        let (from, to) = day_bounds(date);
        assert!(from < to);
        assert_eq!(to - from, 86_400_000);
        assert_eq!(format_ts(from), "2026-10-20 00:00:00");
    }

    #[test]
    fn floors_to_whole_minutes() {
        let base = parse_ts("2026-10-20 14:33:00").unwrap();
        assert_eq!(floor_to_minute(base + 59_999), base);
        assert_eq!(floor_to_minute(base), base);
        assert_eq!(floor_to_minute(base + 60_000), base + 60_000);
        /* 负时间戳（1970 之前）同样向「过去」对齐，不会因为取模符号跳到未来。 */
        assert_eq!(floor_to_minute(-1), -60_000);
    }

    #[test]
    fn parses_seconds_and_minutes() {
        assert!(parse_ts("2026-10-20 09:00:00").is_some());
        assert!(parse_ts("2026-10-20 09:00").is_some());
        assert!(parse_ts("不是时间").is_none());
    }

    #[test]
    fn renders_duration_with_only_the_significant_units() {
        assert_eq!(format_duration(0), "0s");
        assert_eq!(format_duration(45), "45s");
        assert_eq!(format_duration(2766), "46m06s");
        assert_eq!(format_duration(2760), "46m");
        assert_eq!(format_duration(3600), "1h00m");
        assert_eq!(format_duration(5660), "1h34m20s");
        assert_eq!(format_duration(-5), "0s", "负数不做负数时长");
    }

    #[test]
    fn parses_every_shape_it_renders_and_tolerates_hand_edits() {
        for sec in [0, 5, 45, 60, 2760, 2766, 3600, 5660, 86_399] {
            let text = format_duration(sec);
            assert_eq!(parse_duration(&text), Some(sec.max(0)), "往返失败：{text}");
        }
        /* 手写形态：纯数字按秒、大小写单位、带引号。 */
        assert_eq!(parse_duration("2766"), Some(2766));
        assert_eq!(parse_duration("\"1H34M20S\""), Some(5660));
        assert_eq!(parse_duration("46m"), Some(2760));
        /* 认不出来就放弃，不能瞎猜成某个值。 */
        assert_eq!(parse_duration("大约一小时"), None);
        assert_eq!(parse_duration("m"), None);
        assert_eq!(parse_duration(""), None);
    }
}
