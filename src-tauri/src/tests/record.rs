//! 记录域查询/汇总/编辑/删除（Spec §9 AC-16/17；IPC-CONTRACT-v2 §4.3）。
//! 覆盖：仅 saved、分页与边界钳制、时间范围、按事项聚合、编辑校验、软删除幂等。

use crate::error::ErrorCode;
use crate::models::record::RecordPatch;
use crate::services::{record, timer};
use crate::tests::support::{expect_err, fresh_pool, insert_saved, new_item, scalar_i64};

#[tokio::test]
async fn list_returns_only_saved() {
    let pool = fresh_pool("rec-only-saved").await;
    insert_saved(&pool, 1, 1_000, 2_000, 10).await;
    insert_saved(&pool, 1, 3_000, 4_000, 20).await;
    timer::start(&pool, Some(1)).await.unwrap(); // 一条 active，不应出现在明细里

    let page = record::list(&pool, None, None, None, None, None)
        .await
        .unwrap();
    assert_eq!(page.total, 2, "明细仅统计 saved");
    assert!(page.items.iter().all(|r| r.status == "saved"));
}

#[tokio::test]
async fn pagination_total_and_has_more() {
    let pool = fresh_pool("rec-page").await;
    for i in 0..3 {
        insert_saved(&pool, 1, 1_000 + i * 10, 2_000 + i * 10, 5).await;
    }
    let p1 = record::list(&pool, None, None, None, Some(1), Some(2))
        .await
        .unwrap();
    assert_eq!(p1.items.len(), 2);
    assert_eq!(p1.total, 3);
    assert!(p1.has_more, "page*limit<total 应为 true");

    let p2 = record::list(&pool, None, None, None, Some(2), Some(2))
        .await
        .unwrap();
    assert_eq!(p2.items.len(), 1);
    assert!(!p2.has_more);
}

#[tokio::test]
async fn page_and_limit_are_clamped() {
    let pool = fresh_pool("rec-clamp").await;
    insert_saved(&pool, 1, 1_000, 2_000, 1).await;

    let page0 = record::list(&pool, None, None, None, Some(0), Some(1000))
        .await
        .unwrap();
    assert_eq!(page0.page, 1, "page 下限 1");
    assert_eq!(page0.limit, 100, "limit 上限 100");

    let limit0 = record::list(&pool, None, None, None, None, Some(0))
        .await
        .unwrap();
    assert_eq!(limit0.limit, 1, "limit 下限 1");
}

#[tokio::test]
async fn range_filter_is_from_inclusive_to_exclusive() {
    let pool = fresh_pool("rec-range").await;
    insert_saved(&pool, 1, 1_000, 1_500, 5).await; // 命中 [1000,3000)
    insert_saved(&pool, 1, 3_000, 3_500, 5).await; // 不命中（to 不含）

    let page = record::list(&pool, None, Some(1_000), Some(3_000), None, None)
        .await
        .unwrap();
    assert_eq!(page.total, 1);
    assert_eq!(page.items[0].started_at, 1_000);
}

#[tokio::test]
async fn stats_totals_and_by_item_desc() {
    let pool = fresh_pool("rec-stats").await;
    let item2 = new_item(&pool, "乙").await;
    insert_saved(&pool, 1, 1_000, 2_000, 100).await;
    insert_saved(&pool, 1, 3_000, 4_000, 50).await;
    insert_saved(&pool, item2, 5_000, 6_000, 200).await;

    let s = record::stats(&pool, None, None, None).await.unwrap();
    assert_eq!(s.total_sec, 350);
    assert_eq!(s.record_count, 3);
    assert_eq!(s.by_item.len(), 2);
    assert_eq!(s.by_item[0].item_id, item2, "按 totalSec 降序");
    assert_eq!(s.by_item[0].total_sec, 200);
    assert_eq!(s.by_item[1].item_id, 1);
    assert_eq!(s.by_item[1].total_sec, 150);
}

#[tokio::test]
async fn update_active_record_rejected() {
    let pool = fresh_pool("rec-upd-active").await;
    let active = timer::start(&pool, Some(1)).await.unwrap();
    let code = expect_err(
        record::update(
            &pool,
            active.id,
            RecordPatch {
                note: Some("x".into()),
                ..Default::default()
            },
        )
        .await,
    );
    assert_eq!(
        code,
        ErrorCode::ItemNotFound,
        "仅 saved 可编辑；active 走计时命令"
    );
}

#[tokio::test]
async fn update_missing_record_rejected() {
    let pool = fresh_pool("rec-upd-miss").await;
    let code = expect_err(record::update(&pool, 9999, RecordPatch::default()).await);
    assert_eq!(code, ErrorCode::ItemNotFound);
}

#[tokio::test]
async fn update_invalid_duration_rejected() {
    let pool = fresh_pool("rec-upd-dur").await;
    let id = insert_saved(&pool, 1, 10_000, 20_000, 10).await;
    let code = expect_err(
        record::update(
            &pool,
            id,
            RecordPatch {
                ended_at: Some(5_000),
                ..Default::default()
            },
        )
        .await,
    );
    assert_eq!(code, ErrorCode::InvalidDuration);
}

#[tokio::test]
async fn update_note_is_clamped_to_500() {
    let pool = fresh_pool("rec-note").await;
    let id = insert_saved(&pool, 1, 1_000, 2_000, 10).await;
    let updated = record::update(
        &pool,
        id,
        RecordPatch {
            note: Some("a".repeat(600)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(
        updated.note.unwrap().chars().count(),
        500,
        "note 超长截断为 500（不报错）"
    );
}

#[tokio::test]
async fn update_item_change_ok_and_unknown_rejected() {
    let pool = fresh_pool("rec-reassign").await;
    let item2 = new_item(&pool, "乙").await;
    let id = insert_saved(&pool, 1, 1_000, 2_000, 10).await;

    let moved = record::update(
        &pool,
        id,
        RecordPatch {
            item_id: Some(item2),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(moved.item_id, item2);

    let code = expect_err(
        record::update(
            &pool,
            id,
            RecordPatch {
                item_id: Some(9999),
                ..Default::default()
            },
        )
        .await,
    );
    assert_eq!(code, ErrorCode::ItemNotFound);
    // 未生效：归属仍为 item2
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT item_id FROM time_records WHERE id = {id}")
        )
        .await,
        item2
    );
}

#[tokio::test]
async fn delete_record_is_idempotent() {
    let pool = fresh_pool("rec-del").await;
    let id = insert_saved(&pool, 1, 1_000, 2_000, 10).await;
    record::delete(&pool, id).await.unwrap();
    record::delete(&pool, id)
        .await
        .expect("重复删除应静默成功（幂等）");

    let page = record::list(&pool, None, None, None, None, None)
        .await
        .unwrap();
    assert_eq!(page.total, 0, "软删除后不进明细");
}

/// [V0.3.12] 改起止时刻 → 时长跟着区间走；只改备注时保留原累计（可能含暂停）。
#[tokio::test]
async fn editing_times_recomputes_duration() {
    let pool = fresh_pool("rec-times").await;
    let item = new_item(&pool, "写周报").await;
    let id = insert_saved(&pool, item, 1_000_000, 1_600_000, 500).await;

    // 只改备注：累计秒数保持原值（用户没动时间）
    let kept = record::update(
        &pool,
        id,
        RecordPatch {
            note: Some("备注".to_string()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(kept.accumulated_sec, 500, "只改备注不该重算时长");
    assert_eq!(kept.ended_at, Some(1_600_000));

    // 改结束时刻：时长 = 新区间（900s）
    let rec = record::update(
        &pool,
        id,
        RecordPatch {
            ended_at: Some(1_900_000),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(rec.ended_at, Some(1_900_000));
    assert_eq!(rec.accumulated_sec, 900, "改了时刻，时长跟着区间走");

    // 结束早于开始 → INVALID_DURATION，库里不动
    let code = expect_err(
        record::update(
            &pool,
            id,
            RecordPatch {
                ended_at: Some(500_000),
                ..Default::default()
            },
        )
        .await,
    );
    assert_eq!(code, ErrorCode::InvalidDuration);
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT accumulated_sec FROM time_records WHERE id = {id}")
        )
        .await,
        900
    );
}
