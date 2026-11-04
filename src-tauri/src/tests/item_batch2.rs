//! 常用事项 / 固定任务（V0.2.0 批 2 · N-7）：`is_pinned` 置顶排序 + `remindAt` 三态。

use crate::models::item::ItemPatch;
use crate::services::item;
use crate::tests::support::{exec, fresh_pool, new_item, scalar_i64};

#[tokio::test]
async fn pinned_items_sort_first_then_sort_order() {
    let pool = fresh_pool("item-pin-order").await;
    let a = new_item(&pool, "甲").await;
    let b = new_item(&pool, "乙").await;
    let c = new_item(&pool, "丙").await;

    let before = item::list(&pool, false).await.unwrap();
    let pos =
        |list: &[crate::models::item::Item], id: i64| list.iter().position(|i| i.id == id).unwrap();
    assert!(pos(&before, a) < pos(&before, b), "默认按 sort_order 升序");
    assert!(pos(&before, b) < pos(&before, c));

    // 固定丙 → 置顶
    let pinned = item::update(
        &pool,
        c,
        ItemPatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(pinned.is_pinned);

    let after = item::list(&pool, false).await.unwrap();
    assert_eq!(after[0].id, c, "固定任务置顶（is_pinned DESC）");
    assert!(pos(&after, a) < pos(&after, b), "其余仍按 sort_order 升序");
}

#[tokio::test]
async fn unpin_returns_to_sort_order_position() {
    let pool = fresh_pool("item-unpin").await;
    let a = new_item(&pool, "甲").await;
    let b = new_item(&pool, "乙").await;
    item::update(
        &pool,
        b,
        ItemPatch {
            is_pinned: Some(true),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(item::list(&pool, false).await.unwrap()[0].id, b);

    item::update(
        &pool,
        b,
        ItemPatch {
            is_pinned: Some(false),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let list = item::list(&pool, false).await.unwrap();
    assert!(list[0].id != b, "取消固定后不再置顶");
    let pos =
        |list: &[crate::models::item::Item], id: i64| list.iter().position(|i| i.id == id).unwrap();
    assert!(
        pos(&list, a) < pos(&list, b),
        "取消固定后回到 sort_order 升序（a 在 b 之前）"
    );
}

#[tokio::test]
async fn update_remind_at_three_state_and_resets_marker() {
    let pool = fresh_pool("item-remind-patch").await;
    let a = new_item(&pool, "甲").await;
    exec(
        &pool,
        &format!("UPDATE items SET reminded_at = 1 WHERE id = {a}"),
    )
    .await;

    let set = item::update(
        &pool,
        a,
        ItemPatch {
            remind_at: Some(Some(12345)),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(set.remind_at, Some(12345));
    assert!(set.reminded_at.is_none(), "改提醒应清 reminded_at（K-19）");

    let cleared = item::update(
        &pool,
        a,
        ItemPatch {
            remind_at: Some(None),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(cleared.remind_at, None, "显式 null 清除提醒");
}

#[tokio::test]
async fn item_dto_exposes_batch2_fields_camel_case() {
    let pool = fresh_pool("item-dto").await;
    let a = new_item(&pool, "甲").await;
    let item = crate::repositories::item::find_by_id(&pool, a)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT is_pinned FROM items WHERE id = {a}")
        )
        .await,
        0,
        "新建默认未固定"
    );
    let v = serde_json::to_value(&item).unwrap();
    for key in ["remindAt", "remindedAt", "isPinned"] {
        assert!(v.get(key).is_some(), "缺字段 {key}");
    }
}
