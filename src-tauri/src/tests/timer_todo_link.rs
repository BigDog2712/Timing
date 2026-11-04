//! 计时与待办的联动（Spec §9 AC-08 / 软删除后的待办清理）。
//! 从 `timer.rs` 拆出（ADR-017：单文件 ≤300 行）。状态机迁移见 `timer.rs`。

use crate::services::timer;
use crate::tests::support::{allow_short_records, fresh_pool, new_item, rewind, scalar_i64};

#[tokio::test]
async fn stop_soft_deletes_matching_pending_todos_only_after_save() {
    let pool = fresh_pool("timer-todo-link").await;
    // 联动挂在「真正保存」上；阈值关到 0 才能用 2s 的会话走保存路径。
    allow_short_records(&pool).await;
    let item = new_item(&pool, "写周报").await;
    let first = crate::services::todo::create(&pool, "写周报", None, None)
        .await
        .unwrap();
    let _done = crate::services::todo::create(&pool, "写周报", None, None)
        .await
        .unwrap();
    crate::services::todo::toggle(&pool, _done.id, true)
        .await
        .unwrap();
    let rec = timer::start(&pool, Some(item)).await.unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", first.id)
        )
        .await,
        1
    );
    rewind(&pool, rec.id, 2_000).await;
    timer::stop(&pool).await.unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT deleted_at IS NOT NULL FROM todos WHERE id={}",
                first.id
            )
        )
        .await,
        1
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", _done.id)
        )
        .await,
        1
    );
}

#[tokio::test]
async fn start_keeps_matching_pending_todo() {
    let pool = fresh_pool("timer-todo-start").await;
    let item = new_item(&pool, "写周报").await;
    let todo = crate::services::todo::create(&pool, "写周报", None, None)
        .await
        .unwrap();
    timer::start(&pool, Some(item)).await.unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", todo.id)
        )
        .await,
        1
    );
}

#[tokio::test]
async fn discard_keeps_matching_todo() {
    let pool = fresh_pool("timer-discard-todo").await;
    let item = new_item(&pool, "写周报").await;
    let todo = crate::services::todo::create(&pool, "写周报", None, None)
        .await
        .unwrap();
    timer::start(&pool, Some(item)).await.unwrap();
    timer::discard(&pool).await.unwrap();
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT deleted_at IS NULL FROM todos WHERE id={}", todo.id)
        )
        .await,
        1
    );
}
