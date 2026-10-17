//! 待办域（V0.2.0 批 1 · B1）：CRUD 往返 / 软删 / toggle 幂等 / 列表过滤 / 错误码。
//!
//! 断言来源：`ARCHITECTURE-V0.2.0 §5 待办 todo(5)`、`domain-v020.ts`、`browserMockV020.ts`
//! （期望语义参照）。以行为（输入→可观测输出/错误码）为准，不绑定实现内部细节。

use crate::error::ErrorCode;
use crate::models::constants::TODO_TITLE_MAX_LEN;
use crate::models::todo::{TodoListParams, TodoPatch};
use crate::services::todo;
use crate::tests::support::{exec, expect_err, fresh_pool, scalar_i64};

fn patch_planned(v: Option<i64>) -> TodoPatch {
    TodoPatch {
        planned_at: Some(v),
        ..Default::default()
    }
}

#[tokio::test]
async fn create_trims_title_and_assigns_increasing_sort_order() {
    let pool = fresh_pool("todo-create").await;
    let a = todo::create(&pool, "  写周报  ", None, None).await.unwrap();
    assert_eq!(a.title, "写周报", "标题应 trim");
    assert_eq!(a.sort_order, 1, "首个待办 sort_order = 1");
    assert!(a.done_at.is_none(), "新建未完成");
    assert!(a.reminded_at.is_none(), "新建未触发提醒");

    let b = todo::create(&pool, "取快递", None, None).await.unwrap();
    assert_eq!(b.sort_order, 2, "sort_order 递增");
}

#[tokio::test]
async fn create_empty_title_rejected() {
    let pool = fresh_pool("todo-empty").await;
    let code = expect_err(todo::create(&pool, "   ", None, None).await);
    assert_eq!(code, ErrorCode::ItemNameEmpty);
    assert_eq!(scalar_i64(&pool, "SELECT COUNT(*) FROM todos").await, 0);
}

#[tokio::test]
async fn create_overlong_title_rejected_without_insert() {
    let pool = fresh_pool("todo-long").await;
    let long = "字".repeat(TODO_TITLE_MAX_LEN + 1);
    let code = expect_err(todo::create(&pool, &long, None, None).await);
    assert_eq!(code, ErrorCode::ItemNameEmpty, "超长不得静默接受");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM todos").await,
        0,
        "拒绝后不得入库"
    );
}

#[tokio::test]
async fn create_persists_planned_and_remind_at() {
    let pool = fresh_pool("todo-create-times").await;
    let t = todo::create(
        &pool,
        "交周报",
        Some(1_700_000_000_000),
        Some(1_700_000_060_000),
    )
    .await
    .unwrap();
    assert_eq!(t.planned_at, Some(1_700_000_000_000));
    assert_eq!(t.remind_at, Some(1_700_000_060_000));
    // 往返：list 取回同值
    let list = todo::list(&pool, TodoListParams::default()).await.unwrap();
    assert_eq!(list.len(), 1);
    assert_eq!(list[0].planned_at, Some(1_700_000_000_000));
}

#[tokio::test]
async fn update_missing_todo_rejected() {
    let pool = fresh_pool("todo-upd-miss").await;
    let code = expect_err(todo::update(&pool, 4242, TodoPatch::default()).await);
    assert_eq!(code, ErrorCode::TodoNotFound);
}

#[tokio::test]
async fn update_empty_title_rejected() {
    let pool = fresh_pool("todo-upd-empty").await;
    let t = todo::create(&pool, "甲", None, None).await.unwrap();
    let patch = TodoPatch {
        title: Some("   ".into()),
        ..Default::default()
    };
    assert_eq!(
        expect_err(todo::update(&pool, t.id, patch).await),
        ErrorCode::ItemNameEmpty
    );
}

#[tokio::test]
async fn update_planned_at_three_state() {
    let pool = fresh_pool("todo-upd-planned").await;
    let t = todo::create(&pool, "甲", Some(1000), None).await.unwrap();

    // 改值
    let set = todo::update(&pool, t.id, patch_planned(Some(2000)))
        .await
        .unwrap();
    assert_eq!(set.planned_at, Some(2000));
    // 显式置 null（清空）
    let cleared = todo::update(&pool, t.id, patch_planned(None))
        .await
        .unwrap();
    assert_eq!(cleared.planned_at, None, "显式 null 应清空 planned_at");
}

#[tokio::test]
async fn update_remind_at_resets_reminded_marker() {
    let pool = fresh_pool("todo-upd-remind").await;
    let t = todo::create(&pool, "甲", None, Some(5000)).await.unwrap();
    // 预置「已触发」标记（模拟批 2 扫描落位）
    exec(
        &pool,
        &format!("UPDATE todos SET reminded_at = 5000 WHERE id = {}", t.id),
    )
    .await;

    let patch = TodoPatch {
        remind_at: Some(Some(9000)),
        ..Default::default()
    };
    let updated = todo::update(&pool, t.id, patch).await.unwrap();
    assert_eq!(updated.remind_at, Some(9000));
    assert!(
        updated.reminded_at.is_none(),
        "重设提醒应清 reminded_at（K-19：提醒复活）"
    );
}

#[tokio::test]
async fn toggle_is_state_idempotent_and_reversible() {
    let pool = fresh_pool("todo-toggle").await;
    let t = todo::create(&pool, "甲", None, None).await.unwrap();
    assert!(t.done_at.is_none());

    let done = todo::toggle(&pool, t.id, true).await.unwrap();
    assert!(done.done_at.is_some(), "done=true 置 done_at");
    let again = todo::toggle(&pool, t.id, true).await.unwrap();
    assert!(again.done_at.is_some(), "重复 done=true 幂等（仍完成）");
    let undone = todo::toggle(&pool, t.id, false).await.unwrap();
    assert!(undone.done_at.is_none(), "done=false 回原态");
}

#[tokio::test]
async fn toggle_missing_todo_rejected() {
    let pool = fresh_pool("todo-toggle-miss").await;
    assert_eq!(
        expect_err(todo::toggle(&pool, 777, true).await),
        ErrorCode::TodoNotFound
    );
}

#[tokio::test]
async fn list_excludes_done_by_default_and_include_done_wins() {
    let pool = fresh_pool("todo-list-done").await;
    let a = todo::create(&pool, "完成项", None, None).await.unwrap();
    todo::create(&pool, "进行项", None, None).await.unwrap();
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
    todo::create(&pool, "t1", Some(1000), None).await.unwrap();
    todo::create(&pool, "t2", Some(2000), None).await.unwrap();
    todo::create(&pool, "t3", Some(3000), None).await.unwrap();
    todo::create(&pool, "t4-null", None, None).await.unwrap();

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
    let a = todo::create(&pool, "a", Some(3000), None).await.unwrap();
    let b = todo::create(&pool, "b", Some(1000), None).await.unwrap();
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

#[tokio::test]
async fn delete_is_soft_and_idempotent() {
    let pool = fresh_pool("todo-delete").await;
    let t = todo::create(&pool, "待删", None, None).await.unwrap();
    todo::delete(&pool, t.id).await.unwrap();

    // 列表与单查均不可见
    assert!(todo::list(
        &pool,
        TodoListParams {
            include_done: true,
            ..Default::default()
        },
    )
    .await
    .unwrap()
    .is_empty());
    assert!(crate::repositories::todo::find_by_id(&pool, t.id)
        .await
        .unwrap()
        .is_none());

    // 物理行仍在（软删除）
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM todos WHERE id = {} AND deleted_at IS NOT NULL",
                t.id
            )
        )
        .await,
        1
    );

    // 幂等：不存在 / 已软删均静默成功
    todo::delete(&pool, t.id).await.unwrap();
    todo::delete(&pool, 9999).await.unwrap();
}

/// `Option<Option<i64>>` 反序列化三态：缺省 vs 显式 null vs 有值（double_option 守卫）。
#[test]
fn patch_distinguishes_absent_and_explicit_null() {
    let absent: TodoPatch = serde_json::from_str(r#"{"title":"x"}"#).unwrap();
    assert!(absent.planned_at.is_none(), "字段缺省 = 不改");

    let explicit_null: TodoPatch = serde_json::from_str(r#"{"plannedAt":null}"#).unwrap();
    assert_eq!(explicit_null.planned_at, Some(None), "显式 null = 清空");

    let valued: TodoPatch = serde_json::from_str(r#"{"plannedAt":123}"#).unwrap();
    assert_eq!(valued.planned_at, Some(Some(123)), "有值 = 改值");
}
