//! `update_record` 的时长重算（[0.13 · T03b]，判据 V-1.6f）。
//!
//! 断言来源：`DASHBOARD-R2-ARCH.md` §3.8 B4 —— 前端**不许**自己算时长。这条测试把
//! "落库值 == 区间推导值"钉成事实：`RecordPatch` 里根本没有 duration 字段（serde
//! 强类型 struct，多塞的字段被**静默丢弃**），`accumulated_sec` 由
//! `services/record.rs:75-79` 按新区间重算（ADR-030）。给 patch 塞时长字段与否
//! 不改变结果 —— 因为那个字段到不了 Rust。

use crate::models::record::RecordPatch;
use crate::services::record;
use crate::tests::support::{fresh_pool, insert_saved, new_item};

#[tokio::test]
async fn update_recomputes_accumulated_sec_from_the_new_interval() {
    let pool = fresh_pool("rec-update-time").await;
    let item = new_item(&pool, "写周报").await;
    /* 原记录：3h–4h（毫秒时间戳），accumulated 3600s（旧值，马上要被区间重算覆盖） */
    let id = insert_saved(&pool, item, 10_800_000, 14_400_000, 3_600).await;

    /* 把 ended_at 后移 600 s：patch 只带起止，不带时长 */
    let updated = record::update(
        &pool,
        id,
        RecordPatch {
            item_id: None,
            started_at: None,
            ended_at: Some(15_000_000),
            note: None,
        },
    )
    .await
    .unwrap();

    /* 落库值恰等于 Rust 的区间推导（(new_end - started) / 1000），不是 patch 里塞的旧值 */
    assert_eq!(updated.accumulated_sec, 4_200, "accumulated_sec = (new_end - started)/1000");
    assert_eq!(updated.ended_at, Some(15_000_000));
}

#[tokio::test]
async fn update_ignores_any_duration_field_the_caller_invents() {
    let pool = fresh_pool("rec-update-time-b4").await;
    let item = new_item(&pool, "开会").await;
    let id = insert_saved(&pool, item, 20_000_000, 21_000_000, 3_600).await;

    /* B4 的反向攻击：调用方"顺手"算一个时长塞进 patch —— serde 静默丢弃（RecordPatch
       没有 duration 字段），落库值仍是区间推导。前端算时长是死代码，且若 Rust 反过来
       信任外部时长，这条测试就是第一个红的。 */
    let updated = record::update(
        &pool,
        id,
        RecordPatch {
            item_id: None,
            started_at: Some(20_000_000),
            ended_at: Some(22_000_000),
            note: None,
        },
    )
    .await
    .unwrap();

    assert_eq!(updated.accumulated_sec, 2_000, "重算值 = (end-started)/1000，与调用方塞什么无关");
}
