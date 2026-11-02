//! `duration:` 行（V0.4.1）：把「墙钟跨度」和「真实工作时长」分开写。
//!
//! 背景：段里的 `start`/`end` 是墙钟时刻，而 TickBar 的真实计时口径是
//! `accumulated_sec`——应用关闭、电脑休眠期间不累计（`timer::resolve_open` 的 R-2）。
//! 于是一段 `09:18:33 → 14:40:48`（墙钟 5 小时 22 分）可能只计到 46 分钟。
//! 只写 start/end，读日记的人就会把墙钟跨度当成工作时长。
//!
//! 本文件锁死四件事：
//! ①已保存段把真实累计写成 `duration:`，与 start/end 同时可见；
//! ②实时段的 `duration` 与 `end` 同粒度（整分钟）——同一分钟内渲染文本必须逐字节相同，
//!   否则 2 秒一轮的轮询会每轮重写整篇日记；
//! ③`duration` 能往返（render → parse 不失真）；
//! ④**导入完全无视它**：改这一行不触发落库，也不能拿它当累计值。

use crate::services;
use crate::services::md_sync::format::{self, TimerEntry, TimerInterval};
use crate::services::md_sync::{export, import};
use crate::tests::md_sync::{at, env, Env};
use crate::tests::md_sync_live::{day, pin_start};
use crate::tests::support::{insert_saved, new_item, scalar_i64};

async fn accumulated_of(env: &Env, id: i64) -> i64 {
    scalar_i64(
        &env.pool,
        &format!("SELECT accumulated_sec FROM time_records WHERE id = {id}"),
    )
    .await
}

/// ① 真实累计与墙钟跨度并列写出。
#[tokio::test]
async fn saved_segment_carries_the_real_duration_beside_the_wall_span() {
    let env = env("md-duration-saved").await;
    let item = new_item(&env.pool, "测试2").await;
    /* 今天那条真实记录：墙钟 5h22m，实际只计了 46m06s。 */
    let started = at(env.date, 9, 18) + 33_000;
    let ended = at(env.date, 14, 40) + 48_000;
    insert_saved(&env.pool, item, started, ended, 2_766).await;

    let body = export::timers_at(&env.pool, env.date, at(env.date, 15, 0))
        .await
        .unwrap()
        .body;
    let day = day(&env);
    assert!(
        body.contains(&format!("      - start: {day} 09:18:33")),
        "{body}"
    );
    assert!(
        body.contains(&format!("        end: {day} 14:40:48")),
        "{body}"
    );
    assert!(body.contains("        duration: 46m06s"), "{body}");
    /* 不能退化成 `end - start`，那正是这次要消除的误读。 */
    assert!(!body.contains("duration: 5h22m"), "{body}");
}

/// ② 实时段的 `duration` 与 `end` 同粒度：同分钟不变，跨分钟才动。
#[tokio::test]
async fn live_duration_moves_once_per_minute_like_its_end() {
    let env = env("md-duration-live").await;
    let item = new_item(&env.pool, "测试2").await;
    let record = services::timer::start(&env.pool, Some(item)).await.unwrap();
    pin_start(&env, record.id, at(env.date, 9, 18)).await;

    let early = export::timers_at(&env.pool, env.date, at(env.date, 14, 33) + 5_000)
        .await
        .unwrap()
        .body;
    let late = export::timers_at(&env.pool, env.date, at(env.date, 14, 33) + 50_000)
        .await
        .unwrap()
        .body;
    let next = export::timers_at(&env.pool, env.date, at(env.date, 14, 34) + 5_000)
        .await
        .unwrap()
        .body;

    assert_eq!(early, late, "同一分钟内渲染必须逐字节相同：{early}");
    assert_ne!(early, next, "跨分钟后 end 与 duration 都该前进");
    assert!(early.contains("        duration: 5h15m"), "{early}");
    assert!(next.contains("        duration: 5h16m"), "{next}");
}

/// ③ 带上 `duration` 也能往返：渲染出来的必须能解析回去。
#[test]
fn duration_round_trips_through_render_and_parse() {
    let stamp = |text: &str| format::parse_ts(text).expect("时间应可解析");
    let original = vec![TimerEntry {
        item: "测试2".into(),
        intervals: vec![
            TimerInterval::saved(stamp("2026-10-20 09:18:33"), stamp("2026-10-20 14:40:48"))
                .with_duration(2_766),
            TimerInterval::live(stamp("2026-10-20 15:00:00"), stamp("2026-10-20 15:30:00"))
                .with_duration(1_800),
        ],
    }];
    let body = format::render_timers(&original);
    assert!(body.contains("        duration: 46m06s"), "{body}");
    assert!(body.contains("        duration: 30m"), "{body}");
    assert_eq!(format::parse_timers(&body), original);
}

/// ④-a 只改 `duration` 一行 → 不是「文件变了」，不该落库。
#[tokio::test]
async fn editing_the_duration_line_alone_changes_nothing() {
    let env = env("md-duration-standalone").await;
    let item = new_item(&env.pool, "测试2").await;
    let id = insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;

    let baseline = export::timers_at(&env.pool, env.date, at(env.date, 10, 0))
        .await
        .unwrap()
        .body;
    assert!(baseline.contains("duration: 30m"), "{baseline}");

    let edited = baseline.replace("duration: 30m", "duration: 99h");
    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();
    assert_eq!(
        (stats.created, stats.updated, stats.deleted),
        (0, 0, 0),
        "`duration` 是派生展示值，改它不该产生任何写入"
    );
    assert_eq!(accumulated_of(&env, id).await, 1_800);
}

/// ④-b 文件里的 `duration` 改了时间也不采信：落库值仍由 `(start, end)` 反推。
#[tokio::test]
async fn a_dishonest_duration_never_becomes_the_accumulated_value() {
    let env = env("md-duration-ignore").await;
    let item = new_item(&env.pool, "测试2").await;
    let id = insert_saved(
        &env.pool,
        item,
        at(env.date, 9, 0),
        at(env.date, 9, 30),
        1_800,
    )
    .await;

    let baseline = export::timers_at(&env.pool, env.date, at(env.date, 10, 0))
        .await
        .unwrap()
        .body;
    /* 用户把结束时间改到 09:50，同时把 duration 写成 5h（谎报）。 */
    let edited = baseline
        .replace("09:30:00", "09:50:00")
        .replace("duration: 30m", "duration: 5h");
    let stats = import::apply_timers(&env.pool, env.date, &baseline, &edited)
        .await
        .unwrap();
    assert_eq!(stats.updated, 1, "改了 end 才该更新：{edited}");

    /* 09:00 → 09:50 = 3000 秒，由 (start, end) 决定，跟 duration 写什么无关。 */
    assert_eq!(accumulated_of(&env, id).await, 3_000);
}
