//! 提醒域（V0.2.0 批 2 · ADR-010 / K-19）：设置 / 清除 / 待触发 / 到点去重 / 目标校验。

use crate::error::ErrorCode;
use crate::models::reminder::ReminderTarget;
use crate::services::{reminder, todo};
use crate::tests::support::{exec, expect_err, fresh_pool, new_item, scalar_i64};

#[tokio::test]
async fn set_item_reminder_persists_and_returns_title() {
    let pool = fresh_pool("rem-set-item").await;
    let item = new_item(&pool, "写方案").await;
    let r = reminder::set(&pool, ReminderTarget::Item, item, 1_700_000_090_000)
        .await
        .unwrap();
    assert_eq!(r.target, ReminderTarget::Item);
    assert_eq!(r.title, "写方案");
    assert_eq!(r.remind_at, 1_700_000_090_000);
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT remind_at FROM items WHERE id={item}")
        )
        .await,
        1_700_000_090_000
    );
}

#[tokio::test]
async fn set_reminder_resets_fired_marker() {
    let pool = fresh_pool("rem-revive").await;
    let item = new_item(&pool, "甲").await;
    reminder::set(&pool, ReminderTarget::Item, item, 5000)
        .await
        .unwrap();
    // 模拟后台扫描已置位
    exec(
        &pool,
        &format!("UPDATE items SET reminded_at = 5000 WHERE id = {item}"),
    )
    .await;
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT COUNT(*) FROM items WHERE id={item} AND reminded_at IS NOT NULL")
        )
        .await,
        1
    );

    reminder::set(&pool, ReminderTarget::Item, item, 9000)
        .await
        .unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT COUNT(*) FROM items WHERE id={item} AND reminded_at IS NULL")
        )
        .await,
        1,
        "重设提醒应清 reminded_at（K-19 复活）"
    );
}

#[tokio::test]
async fn set_missing_target_returns_target_code() {
    let pool = fresh_pool("rem-miss").await;
    assert_eq!(
        expect_err(reminder::set(&pool, ReminderTarget::Item, 9999, 1).await),
        ErrorCode::ItemNotFound
    );
    assert_eq!(
        expect_err(reminder::set(&pool, ReminderTarget::Todo, 9999, 1).await),
        ErrorCode::TodoNotFound
    );
}

#[tokio::test]
async fn clear_removes_both_columns() {
    let pool = fresh_pool("rem-clear").await;
    let item = new_item(&pool, "甲").await;
    reminder::set(&pool, ReminderTarget::Item, item, 5000)
        .await
        .unwrap();
    exec(
        &pool,
        &format!("UPDATE items SET reminded_at = 5000 WHERE id = {item}"),
    )
    .await;

    reminder::clear(&pool, ReminderTarget::Item, item)
        .await
        .unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT COUNT(*) FROM items WHERE id={item} AND remind_at IS NULL AND reminded_at IS NULL")
        )
        .await,
        1
    );
}

#[tokio::test]
async fn pending_spans_items_and_todos_sorted() {
    let pool = fresh_pool("rem-pending").await;
    let item = new_item(&pool, "事项").await;
    let t = todo::create(&pool, "待办", None, None, None).await.unwrap();
    reminder::set(&pool, ReminderTarget::Item, item, 2000)
        .await
        .unwrap();
    reminder::set(&pool, ReminderTarget::Todo, t.id, 1000)
        .await
        .unwrap();

    let list = reminder::pending(&pool).await.unwrap();
    assert_eq!(list.len(), 2);
    assert_eq!(list[0].target, ReminderTarget::Todo, "按 remind_at ASC");
    assert_eq!(list[0].title, "待办");
    assert_eq!(list[1].target, ReminderTarget::Item);
}

#[tokio::test]
async fn due_excludes_future_and_fired_then_mark_dedupes() {
    let pool = fresh_pool("rem-due").await;
    let item = new_item(&pool, "甲").await;
    let b = new_item(&pool, "乙").await;
    reminder::set(&pool, ReminderTarget::Item, item, 1000)
        .await
        .unwrap(); // 已过期
    reminder::set(&pool, ReminderTarget::Item, b, 9_000_000_000_000)
        .await
        .unwrap(); // 未来

    let due = reminder::due(&pool, 2000).await.unwrap();
    assert_eq!(due.len(), 1, "仅到期未触发的命中");
    assert_eq!(due[0].target_id, item);

    // 置位后不再命中（K-19：每 tick 不重复弹）
    reminder::mark_fired(&pool, &due, 2000).await.unwrap();
    assert!(reminder::due(&pool, 2000).await.unwrap().is_empty());

    // 回滚后恢复（通知失败重试路径）
    reminder::reset_fired(&pool, &due).await.unwrap();
    assert_eq!(reminder::due(&pool, 2000).await.unwrap().len(), 1);
}

#[tokio::test]
async fn clear_unknown_target_rejected() {
    let pool = fresh_pool("rem-clear-miss").await;
    assert_eq!(
        expect_err(reminder::clear(&pool, ReminderTarget::Item, 9999).await),
        ErrorCode::ItemNotFound
    );
}
