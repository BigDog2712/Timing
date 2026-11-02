//! 计时区块「渲染 ↔ 解析」的纯格式用例。
//!
//! 从 `services/md_sync/format.rs` 的 `#[cfg(test)] mod tests` 平移过来：format.rs
//! 加了实时段标记后逼近 300 行（AGENTS.md 硬约束），用例与实现分文件是既有做法
//! （`format/notes.rs` / `format/time.rs` 各自带用例，只有最大的那个挪出来）。

use crate::services::md_sync::format::{
    parse_timers, parse_ts, render_timers, TimerEntry, TimerInterval,
};

fn ms(text: &str) -> i64 {
    parse_ts(text).expect("时间应可解析")
}

#[test]
fn renders_planner_format_like_the_old_diary() {
    let entries = vec![TimerEntry {
        item: "timing优化".into(),
        intervals: vec![TimerInterval::saved(
            ms("2026-10-14 00:30:51"),
            ms("2026-10-14 01:07:41"),
        )],
    }];
    let body = render_timers(&entries);
    assert!(body.starts_with("- [ ] timing优化\n  ```yaml\n  planner:\n    log:\n"));
    assert!(body.contains("      - start: 2026-10-14 00:30:51\n"));
    assert!(body.trim_end().ends_with("  ```"));
    assert!(!body.contains("ongoing"), "完成段不应带实时标记");
}

#[test]
fn parses_what_it_renders() {
    let original = vec![
        TimerEntry {
            item: "A".into(),
            intervals: vec![
                TimerInterval::saved(ms("2026-10-20 09:00:00"), ms("2026-10-20 09:30:00")),
                TimerInterval::saved(ms("2026-10-20 10:00:00"), ms("2026-10-20 10:15:00")),
            ],
        },
        TimerEntry {
            item: "B".into(),
            /* 实时段：渲染 → 解析必须把 `ongoing` 也带回来。 */
            intervals: vec![TimerInterval::live(
                ms("2026-10-20 11:00:00"),
                ms("2026-10-20 12:00:00"),
            )],
        },
    ];
    let body = render_timers(&original);
    assert!(body.contains("        ongoing: true"));
    assert_eq!(parse_timers(&body), original);
}

#[test]
fn parser_ignores_prose_and_handles_checkbox_variants() {
    let body = "随便写点\n- [x] 摸鱼\n  ```yaml\n  planner:\n    log:\n      - start: 2026-10-20 09:00\n        end: 2026-10-20 09:10\n  ```\n";
    let parsed = parse_timers(body);
    assert_eq!(parsed.len(), 1);
    assert_eq!(parsed[0].item, "摸鱼");
    assert_eq!(parsed[0].intervals.len(), 1);
    assert!(!parsed[0].intervals[0].ongoing);
}

#[test]
fn ongoing_marker_only_applies_to_its_own_interval() {
    let body = "- [ ] A\n  - start: 2026-10-20 09:00\n    end: 2026-10-20 09:30\n  - start: 2026-10-20 10:00\n    end: 2026-10-20 11:00\n    ongoing: true\n";
    let parsed = parse_timers(body);
    assert!(!parsed[0].intervals[0].ongoing);
    assert!(parsed[0].intervals[1].ongoing);
}

#[test]
fn prose_that_mentions_ongoing_is_not_a_marker() {
    /* 用户手写「ongoing: true」但不在 end 之后的行：不该被当成实时段标记。 */
    let body =
        "- [ ] A\n  备注 ongoing: true\n  - start: 2026-10-20 09:00\n    end: 2026-10-20 09:30\n";
    let parsed = parse_timers(body);
    assert_eq!(parsed[0].intervals.len(), 1);
    assert!(!parsed[0].intervals[0].ongoing);
}
