//! 批 1 · 云端三档的纯判据（PRD D2 / D4 / D5 / D6 / D8 / D9、H-2，设计 §4.3）。
//!
//! `jobs::md_cloud::decide` 是纯函数：喂「档位 + 时钟 + 最后一次业务写」，断言
//! 「这一圈跑不跑、为什么跑」。云端可用性由调用方判，不在这里重复造判据。

use crate::jobs::md_cloud::{decide, TierReason, TierState};
use crate::models::constants::{
    MD_CLOUD_INTERVAL_DEFAULT_MINUTES, MD_CLOUD_INTERVAL_MAX_MINUTES,
    MD_CLOUD_INTERVAL_MIN_MINUTES, MD_CLOUD_SMART_IDLE_SECS, MD_CLOUD_SMART_MAX_SECS,
    MD_CLOUD_STARTUP_DELAY_SECS,
};
use crate::models::md_sync_auto::{CloudSchedule, MdCloudAuto};
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};

const SEC: i64 = 1_000;

fn tier(startup_ms: i64, startup_done: bool) -> TierState {
    TierState {
        startup_ms,
        startup_done,
        last_attempt_ms: None,
        last_success_ms: None,
    }
}

/// D8：关闭档自动路径彻底不跑，只剩三个手动入口。
#[test]
fn d8_off_never_runs_automatically() {
    let state = tier(0, false);
    assert_eq!(decide(&state, CloudSchedule::Off, 900, 10_000 * SEC, 9_999 * SEC), None);
    let mut later = state.clone();
    later.startup_done = true;
    assert_eq!(decide(&later, CloudSchedule::Off, 900, 40_000 * SEC, 0), None);
}

/// D6：云端可用 + 档位 ≠ 关闭 → 启动后 60s 一次（与 60s 兜底对齐）。
#[test]
fn d6_startup_round_fires_after_sixty_seconds() {
    let state = tier(0, false);
    assert_eq!(decide(&state, CloudSchedule::Smart, 900, 59 * SEC, 0), None);
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, MD_CLOUD_STARTUP_DELAY_SECS as i64 * SEC, 0),
        Some(TierReason::Startup)
    );
    let done = tier(0, true);
    assert_eq!(decide(&done, CloudSchedule::Smart, 900, 60 * SEC, 0), None);
}

/// D5：定时档相邻两轮恰好隔 N 分钟，与有没有改动无关。
#[test]
fn d5_interval_rounds_are_n_minutes_apart_regardless_of_writes() {
    let mut state = tier(0, true);
    state.last_attempt_ms = Some(60 * SEC); /* 启动轮记下的锚点 */
    state.last_success_ms = Some(60 * SEC);
    let n = 15_u64 * 60;
    assert_eq!(
        decide(&state, CloudSchedule::Interval, n, 60 * SEC + 899 * SEC, 0),
        None,
        "没到 N 分钟不许抢跑"
    );
    assert_eq!(
        decide(&state, CloudSchedule::Interval, n, 60 * SEC + 900 * SEC, 0),
        Some(TierReason::Interval)
    );
    /* 期间完全不操作（last_write_ms = 0）也照跑 */
    assert_eq!(
        decide(&state, CloudSchedule::Interval, n, 60 * SEC + 901 * SEC, 0),
        Some(TierReason::Interval),
        "没跑成时下一圈继续欠着"
    );
}

/// D4：智能档前几次写不触发上传，最后一次写之后 5 分钟才来一轮。
#[test]
fn d4_smart_waits_five_minutes_after_the_last_write() {
    let state = tier(0, true); /* 启动轮已跑过，单独验 idle */
    let last_write = 720 * SEC; /* 0 / 4 / 8 / 12 分钟各写一次，停手 */
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, last_write + 299 * SEC, last_write),
        None,
        "连续写期间 5 分钟静默永远不到达"
    );
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, last_write + MD_CLOUD_SMART_IDLE_SECS as i64 * SEC, last_write),
        Some(TierReason::Idle)
    );
}

/// 同一串写已经被一次成功轮传过 → 不许在同一个静默窗口里每秒重复上传。
#[test]
fn a_covered_idle_window_does_not_repeat() {
    let mut state = tier(0, true);
    state.last_success_ms = Some(400 * SEC);
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, 600 * SEC, 300 * SEC),
        None,
        "成功轮发生在最后一次写之后，这笔账已经结了"
    );
}

/// 云端 401 连续失败时不许变成「每秒重发一次网络请求」：任何一轮都把下次尝试推后自己的窗口。
#[test]
fn a_failed_smart_round_is_throttled_instead_of_retrying_every_second() {
    let mut state = tier(0, true);
    state.last_attempt_ms = Some(1_190 * SEC); /* 刚试过一轮且失败，没写 last_success_ms */
    let last_write = 900 * SEC;
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, 1_200 * SEC, last_write),
        None,
        "静默窗口到了，但距上一轮只有 10 秒"
    );
    assert_eq!(
        decide(&state, CloudSchedule::Smart, 900, 1_490 * SEC, last_write),
        Some(TierReason::Idle),
        "满 5 分钟后才允许再试一次"
    );
}

/// D9：每 4 分钟不停写、持续 40 分钟，30 分钟上限必须至少给出 1 轮。
#[test]
fn d9_smart_max_guarantees_a_round_during_continuous_writing() {
    let state = tier(0, true);
    let mut rounds = 0;
    for now in (0..=40 * 60).step_by(60) {
        let now_ms = now * SEC;
        let last_write_ms = (now / 240) * 240 * SEC;
        if decide(&state, CloudSchedule::Smart, 900, now_ms, last_write_ms).is_some() {
            rounds += 1;
        }
    }
    assert!(
        rounds >= 1,
        "连续写库时「停手 5 分钟」永远不到达，必须靠 30 分钟上限兜底"
    );
    assert_eq!(MD_CLOUD_SMART_MAX_SECS, 1_800);
}

/// H-2 / D2：档位与分钟数是两个字段；越界夹边界；切档不重置用户填过的值。
#[test]
fn minutes_are_clamped_persisted_and_never_reset_by_a_schedule_change() {
    let auto = MdCloudAuto {
        schedule: CloudSchedule::Interval,
        interval_minutes: 30,
    };
    let switched = MdCloudAuto {
        schedule: CloudSchedule::Smart,
        ..auto.clone()
    };
    assert_eq!(switched.interval_minutes, 30);
    assert_eq!(switched.interval_secs(), 30 * 60);

    assert_eq!(
        MdCloudAuto { interval_minutes: 1, ..Default::default() }.clamped_minutes(),
        MD_CLOUD_INTERVAL_MIN_MINUTES
    );
    assert_eq!(
        MdCloudAuto { interval_minutes: 999, ..Default::default() }.clamped_minutes(),
        MD_CLOUD_INTERVAL_MAX_MINUTES
    );
    assert_eq!(MdCloudAuto::default().interval_minutes, MD_CLOUD_INTERVAL_DEFAULT_MINUTES);
    assert_eq!(MdCloudAuto::default().schedule, CloudSchedule::Smart);
}

/// 老配置没有 `auto` 键 → 按智能 + 15 分钟解释，而且**序列化回去一个字节都不许多**。
/// 这是 `qa_live_config_roundtrip` 那条整串比对在新字段上的延伸。
#[test]
fn old_cloud_json_without_auto_stays_byte_identical() {
    let raw = r#"{"enabled":true,"mode":"webdav","localRoot":"","baseUrl":"u","basePath":"/p","user":"me"}"#;
    let cloud: MdSyncCloud = serde_json::from_str(raw).expect("老配置必须能解析");
    assert!(cloud.auto.is_none(), "老配置不该被补出默认值");
    assert_eq!(
        serde_json::to_string(&cloud).expect("序列化"),
        raw,
        "一次「什么都没改的保存」不许凭空多出 auto 键"
    );

    let with_auto = MdSyncCloud {
        auto: Some(MdCloudAuto {
            schedule: CloudSchedule::Interval,
            interval_minutes: 30,
        }),
        ..cloud
    };
    let stored = serde_json::to_string(&with_auto).expect("序列化");
    assert!(stored.contains(r#""auto":{"schedule":"interval","intervalMinutes":30}"#));
    let back: MdSyncCloud = serde_json::from_str(&stored).expect("回读");
    assert_eq!(back.auto, with_auto.auto);
    assert_eq!(back.mode, CloudMode::Webdav);
}

/// 日志词表与线缆值：前端 `CloudSchedule` 是这三个 lowercase 字符串。
#[test]
fn schedule_wire_values_match_the_frontend_union() {
    assert_eq!(CloudSchedule::Off.label(), "off");
    assert_eq!(CloudSchedule::Interval.label(), "interval");
    assert_eq!(CloudSchedule::Smart.label(), "smart");
    let parsed: MdCloudAuto = serde_json::from_str(r#"{"schedule":"interval","intervalMinutes":30}"#)
        .expect("前端写下来的形状必须能解析");
    assert_eq!(parsed.schedule, CloudSchedule::Interval);
    assert_eq!(parsed.interval_minutes, 30);
}
