//! 倒计时（V0.2.0 批 2 · ADR-011 / AC-62）：目标校验 / 到点判定 / 钳制 / 自动结束开关。

use sqlx::SqlitePool;

use crate::error::ErrorCode;
use crate::models::constants::MAX_COUNTDOWN_SEC;
use crate::models::settings::SettingsPatch;
use crate::services::{countdown, settings, timer};
use crate::tests::support::{count_active, exec, expect_err, fresh_pool, new_item, scalar_i64};

/// 把会话的 started_at / running_since 同步回拨 ms 毫秒。
async fn rewind(pool: &SqlitePool, id: i64, ms: i64) {
    exec(
        pool,
        &format!(
            "UPDATE time_records \
             SET started_at = started_at - {ms}, running_since = running_since - {ms} \
             WHERE id = {id}"
        ),
    )
    .await;
}

async fn set_auto_end(pool: &SqlitePool, enabled: bool) {
    settings::update(
        pool,
        &SettingsPatch {
            countdown_auto_end: Some(enabled),
            ..Default::default()
        },
    )
    .await
    .unwrap();
}

#[tokio::test]
async fn start_countdown_sets_mode_and_target() {
    let pool = fresh_pool("cd-start").await;
    let rec = countdown::start(&pool, None, 1500).await.unwrap();
    assert_eq!(rec.mode, "countdown");
    assert_eq!(rec.target_sec, Some(1500));
    assert_eq!(rec.status, "active");

    let st = timer::state(&pool).await.unwrap();
    assert_eq!(st.mode, "countdown");
    assert_eq!(st.remaining_sec, Some(1500), "刚开时剩余 = target");
    assert_eq!(st.live_duration_sec, 0);
}

#[tokio::test]
async fn start_countdown_invalid_target_rejected() {
    let pool = fresh_pool("cd-bad-target").await;
    for bad in [0, -5, MAX_COUNTDOWN_SEC + 1] {
        assert_eq!(
            expect_err(countdown::start(&pool, None, bad).await),
            ErrorCode::InvalidTargetSec,
            "target={bad} 应拒绝"
        );
    }
    assert_eq!(count_active(&pool).await, 0, "拒绝时不得留下 active");
}

#[tokio::test]
async fn start_countdown_when_running_rejected() {
    let pool = fresh_pool("cd-already").await;
    countdown::start(&pool, Some(1), 60).await.unwrap();
    assert_eq!(
        expect_err(countdown::start(&pool, Some(1), 60).await),
        ErrorCode::TimerAlreadyRunning
    );
    assert_eq!(count_active(&pool).await, 1);
}

#[tokio::test]
async fn start_countdown_unknown_item_rejected() {
    let pool = fresh_pool("cd-bad-item").await;
    assert_eq!(
        expect_err(countdown::start(&pool, Some(9999), 60).await),
        ErrorCode::ItemNotFound
    );
}

#[tokio::test]
async fn tick_none_before_target() {
    let pool = fresh_pool("cd-tick-early").await;
    countdown::start(&pool, Some(1), 60).await.unwrap();
    assert!(
        countdown::tick(&pool).await.unwrap().is_none(),
        "未到点 → None"
    );
}

#[tokio::test]
async fn tick_notify_only_keeps_session_active_by_default() {
    let pool = fresh_pool("cd-tick-notify").await;
    let rec = countdown::start(&pool, Some(1), 60).await.unwrap();
    rewind(&pool, rec.id, 61_000).await;

    let fired = countdown::tick(&pool).await.unwrap().expect("应到点");
    assert!(!fired.ended, "AC-62 默认不自动结束");
    assert_eq!(fired.target_sec, 60);
    assert_eq!(fired.record.status, "active", "仍 active");
    assert_eq!(count_active(&pool).await, 1);
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE status='saved'"
        )
        .await,
        0
    );
}

#[tokio::test]
async fn tick_auto_end_finalizes_and_clamps_to_target() {
    let pool = fresh_pool("cd-tick-auto").await;
    set_auto_end(&pool, true).await;
    let rec = countdown::start(&pool, Some(1), 60).await.unwrap();
    // 回拨远超 target（+1s），验证钳到精确落点
    rewind(&pool, rec.id, 61_000).await;

    let fired = countdown::tick(&pool).await.unwrap().expect("应到点");
    assert!(fired.ended, "开关开 → 自动结束");
    assert_eq!(fired.record.status, "saved");
    assert_eq!(fired.record.accumulated_sec, 60, "时长钳到 target");
    assert_eq!(
        fired.record.ended_at.unwrap() - fired.record.started_at,
        60_000,
        "ended_at = started_at + target*1000"
    );
    assert_eq!(count_active(&pool).await, 0);
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
}

#[tokio::test]
async fn remaining_sec_clamps_and_is_none_for_countup() {
    let pool = fresh_pool("cd-remaining").await;
    // countup → None
    let up = timer::start(&pool, Some(1)).await.unwrap();
    assert_eq!(timer::state(&pool).await.unwrap().remaining_sec, None);
    assert_eq!(countdown::remaining_sec(&up, 10), None);

    timer::stop(&pool).await.unwrap();
    let rec = countdown::start(&pool, Some(1), 30).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;
    let st = timer::state(&pool).await.unwrap();
    assert_eq!(st.remaining_sec, Some(25), "30 - 5 = 25");

    // 超过 target → 钳到 0
    rewind(&pool, rec.id, 40_000).await;
    assert_eq!(timer::state(&pool).await.unwrap().remaining_sec, Some(0));
}

#[tokio::test]
async fn countdown_auto_end_defaults_off() {
    let pool = fresh_pool("cd-default-off").await;
    assert!(
        !settings::countdown_auto_end(&pool).await.unwrap(),
        "AC-62 默认关"
    );
    set_auto_end(&pool, true).await;
    assert!(settings::countdown_auto_end(&pool).await.unwrap());
}

#[tokio::test]
async fn manual_stop_before_target_keeps_actual_live() {
    let pool = fresh_pool("cd-stop-early").await;
    let item = new_item(&pool, "乙").await;
    let rec = countdown::start(&pool, Some(item), 600).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;

    let stopped = timer::stop(&pool).await.unwrap();
    assert_eq!(stopped.status, "saved");
    assert_eq!(stopped.accumulated_sec, 5, "手动提前结束记实际经过时长");
}
