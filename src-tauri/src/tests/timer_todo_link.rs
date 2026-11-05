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
    let first = crate::services::todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();
    let _done = crate::services::todo::create(&pool, "写周报", None, None, None)
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
    let todo = crate::services::todo::create(&pool, "写周报", None, None, None)
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
    let todo = crate::services::todo::create(&pool, "写周报", None, None, None)
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

/// [V0.11.3] 绑定事项优先于标题：改了标题也不会裂成两个事项。
///
/// 这是绑定要解决的原始问题：待办「写周报」已经计过三小时，用户把它改成
/// 「写周报（二稿）」，旧逻辑会按新标题新建一个事项，同一件事在统计里成两条。
#[tokio::test]
async fn bound_todo_keeps_its_item_after_rename() {
    let pool = fresh_pool("todo-bound-item").await;
    allow_short_records(&pool).await;
    let item = new_item(&pool, "写周报").await;

    let todo = crate::services::todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();
    assert_eq!(todo.item_id, Some(item), "创建时按标题自动绑上已有事项");

    let renamed = crate::services::todo::update(
        &pool,
        todo.id,
        crate::models::todo::TodoPatch {
            title: Some("写周报（二稿）".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(renamed.item_id, Some(item), "改标题不动绑定");

    let record = crate::services::todo_start::start(&pool, todo.id)
        .await
        .unwrap();
    assert_eq!(record.item_id, item, "开始计时用的是绑定的事项");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM items WHERE name = '写周报（二稿）'"
        )
        .await,
        0,
        "不应因为改名而新建事项"
    );
}

/// [V0.11.3] 老数据（没有绑定）在第一次开始计时时按标题匹配，并把结果回填。
#[tokio::test]
async fn unbound_todo_backfills_item_on_start() {
    let pool = fresh_pool("todo-item-backfill").await;
    allow_short_records(&pool).await;
    let item = new_item(&pool, "回填事项").await;

    /* 直接插一条 `item_id` 为空的待办，模拟 V0.11.3 之前留下的数据。 */
    let todo_id: i64 = sqlx::query_scalar(
        "INSERT INTO todos \
         (title, planned_at, remind_at, reminded_at, done_at, sort_order, created_at, updated_at) \
         VALUES ('回填事项', NULL, NULL, NULL, NULL, 0, 0, 0) RETURNING id",
    )
    .fetch_one(&pool)
    .await
    .unwrap();

    let record = crate::services::todo_start::start(&pool, todo_id)
        .await
        .unwrap();
    assert_eq!(record.item_id, item, "按标题匹配到了已有事项");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT item_id FROM todos WHERE id = {todo_id}")
        )
        .await,
        item,
        "匹配结果要回填，之后改名不再影响归属"
    );
}
