//! 倒计时（V0.2.0 批 2 · ADR-011 / AC-62）：目标校验 / 到点判定 / 钳制。
//!
//! [V0.3.4] 「到点自动结束并保存」开关已下架（ADR-023）：**到点一律结束并保存**。
//! 因此原来「开关关 → 保持 active」的用例改为断言落库形态；并新增一条
//! 「倒计时到点不受最短记录时长约束」的用例（阈值只作用于手动停止）。

use sqlx::SqlitePool;

use crate::error::ErrorCode;
use crate::models::constants::MAX_COUNTDOWN_SEC;
use crate::models::settings::ReferenceSettingsPatch;
use crate::services::{countdown, settings, timer};
use crate::tests::support::{
    allow_short_records, count_active, exec, expect_err, fresh_pool, new_item, scalar_i64,
};

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

/// 把「最短记录时长」调到指定秒数（验证倒计时到点是否受它约束）。
async fn set_min_record_seconds(pool: &SqlitePool, sec: i64) {
    settings::update_reference(
        pool,
        &ReferenceSettingsPatch {
            min_record_seconds: Some(sec),
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

/// [V0.3.4] 到点一律结束：会话转 saved、active 清零、只留一条已保存记录。
#[tokio::test]
async fn tick_always_finalizes_session() {
    let pool = fresh_pool("cd-tick-always").await;
    let rec = countdown::start(&pool, Some(1), 60).await.unwrap();
    rewind(&pool, rec.id, 61_000).await;

    let fired = countdown::tick(&pool).await.unwrap().expect("应到点");
    assert!(fired.ended, "V0.3.4 起到点恒结束（无开关）");
    assert_eq!(fired.target_sec, 60);
    assert_eq!(fired.record.status, "saved", "会话已落盘");
    assert_eq!(fired.record.accumulated_sec, 60, "时长钳到 target");
    assert_eq!(
        fired.record.ended_at.unwrap() - fired.record.started_at,
        60_000,
        "ended_at = started_at + target*1000"
    );
    assert_eq!(count_active(&pool).await, 0, "不得留下 active");
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE status='saved' AND deleted_at IS NULL"
        )
        .await,
        1
    );
}

/// [V0.3.4] 倒计时到点**不**受「最短记录时长」约束：目标时长是用户显式设定的。
#[tokio::test]
async fn tick_ignores_min_record_seconds() {
    let pool = fresh_pool("cd-tick-threshold").await;
    // 阈值调到 300s，远超这次 60s 的目标
    set_min_record_seconds(&pool, 300).await;
    let rec = countdown::start(&pool, Some(1), 60).await.unwrap();
    rewind(&pool, rec.id, 61_000).await;

    let fired = countdown::tick(&pool).await.unwrap().expect("应到点");
    assert_eq!(fired.record.status, "saved", "到点即保存，与阈值无关");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE deleted_at IS NULL"
        )
        .await,
        1,
        "记录未被软删"
    );
}

#[tokio::test]
async fn remaining_sec_clamps_and_is_none_for_countup() {
    let pool = fresh_pool("cd-remaining").await;
    // 阈值关掉：本用例紧接着要开倒计时，不关心短会话是否落库
    allow_short_records(&pool).await;
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
async fn manual_stop_before_target_keeps_actual_live() {
    let pool = fresh_pool("cd-stop-early").await;
    // 手动结束走「最短记录时长」判定，这里只验时长口径 → 阈值关到 0
    allow_short_records(&pool).await;
    let item = new_item(&pool, "乙").await;
    let rec = countdown::start(&pool, Some(item), 600).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;

    let result = timer::stop(&pool).await.unwrap();
    assert!(!result.discarded, "阈值 0 → 提前结束也保存");
    let stopped = result.record;
    assert_eq!(stopped.status, "saved");
    assert_eq!(stopped.accumulated_sec, 5, "手动提前结束记实际经过时长");
}
