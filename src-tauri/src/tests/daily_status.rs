//! Daily status validation, date isolation, and timer/todo transaction rollback.

use crate::error::ErrorCode;
use crate::infra::clock::now_ms;
use crate::repositories::record_session;
use crate::services::{daily_status, todo};
use crate::tests::support::{expect_err, fresh_pool, new_item, scalar_i64};

#[tokio::test]
async fn rejects_invalid_date_and_status() {
    let pool = fresh_pool("daily-status-invalid").await;
    assert_eq!(
        expect_err(daily_status::get(&pool, "2025-13-01").await),
        ErrorCode::InvalidDuration
    );
    assert_eq!(
        expect_err(daily_status::set(&pool, "not-a-date", 1, "pending").await),
        ErrorCode::InvalidDuration
    );
    assert_eq!(
        expect_err(daily_status::set(&pool, "2025-03-01", 1, "unknown").await),
        ErrorCode::InvalidDuration
    );
}

#[tokio::test]
async fn rejects_unknown_item() {
    let pool = fresh_pool("daily-status-item-missing").await;
    assert_eq!(
        expect_err(daily_status::set(&pool, "2025-03-01", 9999, "done").await),
        ErrorCode::ItemNotFound
    );
}

#[tokio::test]
async fn statuses_round_trip_independently_per_date() {
    let pool = fresh_pool("daily-status-roundtrip").await;
    let item = new_item(&pool, "今天事项").await;
    daily_status::set(&pool, "2025-03-01", item, "pending")
        .await
        .unwrap();
    daily_status::set(&pool, "2025-03-02", item, "done")
        .await
        .unwrap();

    let day1 = daily_status::get(&pool, "2025-03-01").await.unwrap();
    let day2 = daily_status::get(&pool, "2025-03-02").await.unwrap();
    assert_eq!(day1.get(&item).map(String::as_str), Some("pending"));
    assert_eq!(day2.get(&item).map(String::as_str), Some("done"));
    assert_eq!(day1.len(), 1);
    assert_eq!(day2.len(), 1);
}

#[tokio::test]
async fn failed_segment_save_rolls_back_todo_soft_delete() {
    let pool = fresh_pool("timer-todo-rollback").await;
    let item = new_item(&pool, "交付报告").await;
    let todo = todo::create(&pool, "交付报告", None, None).await.unwrap();
    let now = now_ms();
    let record_id = record_session::insert_active(&pool, item, now)
        .await
        .unwrap();

    let result = record_session::end_and_start(&pool, record_id, 9999, 1, now + 1, now + 1).await;
    assert!(result.is_err(), "nonexistent next item must fail its FK");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT status = 'active' FROM time_records WHERE id={record_id}"),
        )
        .await,
        1,
        "segment transaction must roll back finalization too"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", todo.id),
        )
        .await,
        1,
        "failed save must preserve pending todo"
    );
}
