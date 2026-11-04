//! 时间口径黄金用例（R8）——与前端 `useTimerTick.test.ts` 读同一份 fixture。
//!
//! 三处实现（Rust `live_duration` / 前端 `computeLiveSec` / `PillBar` 剩余时长）如果
//! 各自演化，用户会看到「暂停后数字跳一下」「跨过 59 秒不进位」这类没法复现的怪现象。
//! 用同一张表钉死边界，是最省事的防漂移手段。

use serde::Deserialize;

use crate::models::record::TimeRecord;
use crate::services::timer;

const FIXTURE: &str = include_str!("../../../tests/fixtures/timer-formula.json");

#[derive(Deserialize)]
struct Fixture {
    cases: Vec<Case>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Case {
    name: String,
    accumulated_sec: i64,
    delta_ms: Option<i64>,
    expect: i64,
}

fn record(c: &Case) -> TimeRecord {
    const WALL: i64 = 1_700_000_000_000;
    TimeRecord {
        id: 1,
        item_id: 1,
        status: "active".to_string(),
        started_at: WALL,
        ended_at: None,
        accumulated_sec: c.accumulated_sec,
        running_since: c.delta_ms.map(|_| WALL),
        note: None,
        mode: "countup".to_string(),
        target_sec: None,
    }
}

#[test]
fn live_duration_matches_shared_fixture() {
    let fixture: Fixture = serde_json::from_str(FIXTURE).expect("fixture 解析失败");
    assert!(fixture.cases.len() >= 12, "黄金用例不应少于 12 条");

    for c in &fixture.cases {
        let rec = record(c);
        let now = match c.delta_ms {
            Some(delta) => rec.running_since.unwrap_or(0) + delta,
            None => 1_700_000_000_000,
        };
        assert_eq!(
            timer::live_duration(&rec, now),
            c.expect,
            "用例「{}」不符：累计 {}s，Δ{:?}ms",
            c.name,
            c.accumulated_sec,
            c.delta_ms
        );
    }
}
