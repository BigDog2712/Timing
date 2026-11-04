//! 「最短记录时长」阈值（V0.3.4，ADR-023）：低于阈值的**非显式保存**会话不产生记录。
//!
//! 从 `timer.rs` 拆出（单文件 ≤300 行纪律）。状态机迁移见 `timer.rs`。
//!
//! 覆盖三件事：
//!   1. 手动结束（`timer::stop`）低于阈值 → 软删 + `discarded = true`；
//!   2. 切换事项的分段（`switch` 的 `EndAndStart`）同理，但**切换不中断**；
//!   3. 两条显式保存的路径**不受**阈值约束：倒计时到点（`countdown.rs`）、
//!      崩溃恢复的「结束并保存」（`resolve_open` 的 `Close`）。

use crate::models::enums::{ResolveAction, SwitchMode};
use crate::services::timer;
use crate::tests::support::{
    allow_short_records, count_active, fresh_pool, new_item, rewind, scalar_i64,
};

/// 低于阈值：软删、不入库、`discarded = true`。
#[tokio::test]
async fn stop_discards_below_min_record_seconds() {
    let pool = fresh_pool("timer-stop-discard").await;
    // 出厂阈值 = 30s，这里只跑了 5s
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;

    let result = timer::stop(&pool).await.unwrap();
    assert!(result.discarded, "5s < 30s 阈值 → 不记录");
    assert_eq!(result.record.status, "saved", "对外快照仍是已结束形态");
    assert_eq!(result.record.accumulated_sec, 5);
    assert_eq!(count_active(&pool).await, 0, "会话不得留在 active");
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
    // 软删：行还在，但任何「未删除」视图都看不到它
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM time_records").await,
        1,
        "软删不是物理删"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE deleted_at IS NULL"
        )
        .await,
        0
    );
}

/// 判定是「严格小于」：正好等于阈值必须保存。
#[tokio::test]
async fn stop_saves_exactly_at_threshold() {
    let pool = fresh_pool("timer-stop-threshold").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 30_000).await;

    let result = timer::stop(&pool).await.unwrap();
    assert!(!result.discarded, "30s = 阈值，应保存（< 才忽略）");
    assert_eq!(result.record.accumulated_sec, 30);
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE deleted_at IS NULL"
        )
        .await,
        1
    );
}

/// 阈值可通过参考设置调整：调到 0 后短会话照样保存（设置页滑杆的效果口径）。
#[tokio::test]
async fn threshold_is_configurable() {
    let pool = fresh_pool("timer-stop-threshold-cfg").await;
    allow_short_records(&pool).await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 2_000).await;

    let result = timer::stop(&pool).await.unwrap();
    assert!(!result.discarded, "阈值 0 → 2s 也保存");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE deleted_at IS NULL"
        )
        .await,
        1
    );
}

/// 分段（`switch` 的 `EndAndStart`）：旧段太短被丢弃，但**新会话照常开始**。
#[tokio::test]
async fn switch_discards_short_segment() {
    let pool = fresh_pool("timer-switch-discard").await;
    let item2 = new_item(&pool, "乙").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;
    // EndAndStart 要求「暂停中」：先暂停，把 5s 折进 accumulated_sec
    timer::pause(&pool).await.unwrap();

    let st = timer::switch(&pool, item2, SwitchMode::EndAndStart)
        .await
        .expect("旧段再短，切换也不能失败");
    assert_eq!(st.status, "running", "新会话必须已经开始");
    assert_eq!(st.session.as_ref().unwrap().item_id, item2);
    assert_eq!(count_active(&pool).await, 1, "全局仍只有一条 active");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM time_records WHERE id={} AND deleted_at IS NOT NULL",
                rec.id
            )
        )
        .await,
        1,
        "5s 的旧段应被软删（不在记录列表里）"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT accumulated_sec FROM time_records WHERE id={}",
                rec.id
            )
        )
        .await,
        5,
        "软删也要留真实累计，不能写 0"
    );
}

/// 例外一：崩溃恢复的「结束并保存」是显式选择，再短也保存。
#[tokio::test]
async fn resolve_close_ignores_min_record_seconds() {
    let pool = fresh_pool("timer-close-threshold").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;
    timer::pause(&pool).await.unwrap();

    let out = timer::resolve_open(&pool, ResolveAction::Close, None, false)
        .await
        .unwrap()
        .expect("close 返回记录本体");
    assert_eq!(out.status, "saved");
    assert_eq!(out.accumulated_sec, 5);
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM time_records WHERE id={} AND deleted_at IS NULL",
                rec.id
            )
        )
        .await,
        1,
        "用户显式选了「结束并保存」，5s 也必须留下"
    );
}
