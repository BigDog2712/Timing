//! 待办列表过滤 / 排序（V0.11.3 从 `todo.rs` 拆出，单文件 ≤300 行）。
//!
//! 断言来源：`ARCHITECTURE-V0.2.0 §5 待办 todo(5)`、`domain-v020.ts`。
//! 只覆盖 `todo_list` 的三种行为：默认过滤已完成、时间区间半开、排序优先级。

use crate::models::todo::{TodoListParams, TodoPatch};
use crate::services::todo;
use crate::tests::support::fresh_pool;

#[tokio::test]
async fn list_excludes_done_by_default_and_include_done_wins() {
    let pool = fresh_pool("todo-list-done").await;
    let a = todo::create(&pool, "完成项", None, None, None)
        .await
        .unwrap();
    todo::create(&pool, "进行项", None, None, None)
        .await
        .unwrap();
    todo::toggle(&pool, a.id, true).await.unwrap();

    let default = todo::list(&pool, TodoListParams::default()).await.unwrap();
    assert_eq!(default.len(), 1, "默认排除已完成");
    assert_eq!(default[0].title, "进行项");

    let all = todo::list(
        &pool,
        TodoListParams {
            include_done: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(all.len(), 2, "includeDone 含已完成");
}

#[tokio::test]
async fn list_date_range_is_from_inclusive_to_exclusive() {
    let pool = fresh_pool("todo-list-range").await;
    todo::create(&pool, "t1", None, Some(1000), None)
        .await
        .unwrap();
    todo::create(&pool, "t2", None, Some(2000), None)
        .await
        .unwrap();
    todo::create(&pool, "t3", None, Some(3000), None)
        .await
        .unwrap();
    todo::create(&pool, "t4-null", None, None, None)
        .await
        .unwrap();

    let bounded = todo::list(
        &pool,
        TodoListParams {
            include_done: false,
            from: Some(2000),
            to: Some(3000),
        },
    )
    .await
    .unwrap();
    assert_eq!(
        bounded.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        vec!["t2"],
        "from 含 / to 不含；planned_at 为空的行被排除"
    );

    let from_only = todo::list(
        &pool,
        TodoListParams {
            include_done: false,
            from: Some(2000),
            to: None,
        },
    )
    .await
    .unwrap();
    assert_eq!(from_only.len(), 2, "from 起（含）到尾部");

    let unbounded = todo::list(&pool, TodoListParams::default()).await.unwrap();
    assert_eq!(unbounded.len(), 4, "无区间含未排期行");
}

#[tokio::test]
async fn list_orders_by_sort_order_then_planned_at() {
    let pool = fresh_pool("todo-list-order").await;
    let a = todo::create(&pool, "a", None, Some(3000), None)
        .await
        .unwrap();
    let b = todo::create(&pool, "b", None, Some(1000), None)
        .await
        .unwrap();
    // 拉到同一 sort_order → 次级键 planned_at 升序
    for id in [a.id, b.id] {
        todo::update(
            &pool,
            id,
            TodoPatch {
                sort_order: Some(7),
                ..Default::default()
            },
        )
        .await
        .unwrap();
    }
    let list = todo::list(&pool, TodoListParams::default()).await.unwrap();
    assert_eq!(
        list.iter().map(|t| t.title.as_str()).collect::<Vec<_>>(),
        vec!["b", "a"],
        "同 sort_order 按 planned_at 升序"
    );
}
