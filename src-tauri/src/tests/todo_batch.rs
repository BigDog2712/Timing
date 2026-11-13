//! `todo_create_batch` 的原子性（[0.13 · 1.7]，判据 V-1.7c）。
//!
//! 断言来源：`DASHBOARD-R2-ARCH.md` T03a V-1.7c —— 传 3 条、第 2 条标题为空 →
//! 返回 `ITEM_NAME_EMPTY` 且**库里 0 行新增**。这条判据的存在理由：把「批量创建 =
//! 一条命令、单事务」钉成事实。若有人把它退化成"前端循环调 `todo_create`"（变异 ④），
//! 第 1 条会落库 → `COUNT(*)` 变 1 → 本文件直接红。

use crate::error::ErrorCode;
use crate::models::todo::TodoCreateInput;
use crate::services::todo;
use crate::tests::support::{expect_err, fresh_pool, scalar_i64};

fn input(title: &str) -> TodoCreateInput {
    TodoCreateInput {
        title: title.to_string(),
        planned_at: None,
        remind_at: None,
    }
}

#[tokio::test]
async fn batch_is_atomic_second_empty_title_rolls_back_everything() {
    let pool = fresh_pool("todo-batch-atomic").await;

    let err = expect_err(todo::create_batch(
        &pool,
        vec![input("第一条"), input("   "), input("第三条")],
    )
    .await);
    assert_eq!(err, ErrorCode::ItemNameEmpty, "第 2 条空标题 → ITEM_NAME_EMPTY");

    /* 单事务：失败批 **0 行新增** —— 第 1 条不许已经落库 */
    let count = scalar_i64(&pool, "SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL").await;
    assert_eq!(count, 0, "任一条校验失败整批回滚，库里 0 行新增");
}

#[tokio::test]
async fn batch_inserts_all_rows_with_ascending_sort_order() {
    let pool = fresh_pool("todo-batch-ok").await;

    let created = todo::create_batch(
        &pool,
        vec![
            TodoCreateInput { title: "周一 09:00".into(), planned_at: Some(1_000), remind_at: Some(1_000) },
            TodoCreateInput { title: "周一 21:00".into(), planned_at: Some(2_000), remind_at: None },
            TodoCreateInput { title: "周二 09:00".into(), planned_at: Some(3_000), remind_at: None },
        ],
    )
    .await
    .unwrap();

    assert_eq!(created.len(), 3);
    let count = scalar_i64(&pool, "SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL").await;
    assert_eq!(count, 3, "三条全落库");
    for (index, todo) in created.iter().enumerate() {
        assert_eq!(todo.sort_order, index as i64 + 1, "批量行 sort_order 连续递增");
        assert_eq!(todo.title, if index == 0 { "周一 09:00" } else if index == 1 { "周一 21:00" } else { "周二 09:00" });
    }
    assert_eq!(created[0].planned_at, Some(1_000));
    assert_eq!(created[0].remind_at, Some(1_000), "勾了提醒的行 remind_at 与 planned_at 同值");
    assert_eq!(created[1].remind_at, None, "不勾提醒的行 remind_at 必须是 null");
}

#[tokio::test]
async fn batch_rejects_oversized_payloads() {
    let pool = fresh_pool("todo-batch-bounds").await;

    assert_eq!(
        expect_err(todo::create_batch(
            &pool,
            (0..61).map(|i| input(&format!("t{i}"))).collect()
        )
        .await),
        ErrorCode::DbError,
        "> 60 条：契约上限，整批拒绝（防御分支；前端 TODO_BATCH_MAX 先拦，正常走不到）"
    );
    let count = scalar_i64(&pool, "SELECT COUNT(*) FROM todos WHERE deleted_at IS NULL").await;
    assert_eq!(count, 0, "超限批同样 0 行新增");
}
