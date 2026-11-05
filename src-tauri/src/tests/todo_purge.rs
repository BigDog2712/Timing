//! 待办过期自动清理（V0.3.15 / ADR-032）：截止时间过了「今天 00:00」的未完成待办 → 软删除。
//!
//! 与「待办区只显示今天」共用同一条自然日边界：今天已经看不到的待办就不留着。
//! 只看 `planned_at`（截止 / 承诺时刻）—— 没有截止时间的待办永远不会过期；
//! 已完成的不清（那是当天的成果）。软删除，库里仍可追溯。

use crate::services::todo;
use crate::tests::support::{fresh_pool, scalar_i64};

use crate::models::todo::{TodoListParams, TodoPatch};

const DAY: i64 = 86_400_000;

async fn alive(pool: &sqlx::SqlitePool, id: i64) -> i64 {
    scalar_i64(
        pool,
        &format!("SELECT deleted_at IS NULL FROM todos WHERE id = {id}"),
    )
    .await
}

#[tokio::test]
async fn purge_removes_only_past_due_pending_todos() {
    let pool = fresh_pool("todo-purge").await;
    let today_start = 1_700_000_000_000;
    let yesterday = today_start - 1;

    let past = todo::create(&pool, "昨天的截止", None, Some(yesterday), None)
        .await
        .unwrap();
    let past_noon = todo::create(&pool, "昨天中午", None, Some(today_start - DAY / 2), None)
        .await
        .unwrap();
    let remind_only = todo::create(&pool, "只有昨天的开始", None, None, Some(yesterday))
        .await
        .unwrap();
    let today = todo::create(&pool, "今天截止", None, Some(today_start + DAY / 2), None)
        .await
        .unwrap();
    let future = todo::create(
        &pool,
        "明天的",
        None,
        Some(today_start + DAY + DAY / 2),
        None,
    )
    .await
    .unwrap();
    let undated = todo::create(&pool, "没排期", None, None, None)
        .await
        .unwrap();
    let done = todo::create(&pool, "昨天已完成", None, Some(yesterday), None)
        .await
        .unwrap();
    todo::toggle(&pool, done.id, true).await.unwrap();

    let removed = todo::purge_overdue(&pool, today_start).await.unwrap();
    assert_eq!(removed, 2, "只有两条今天之前的未完成待办");
    assert_eq!(alive(&pool, past.id).await, 0);
    assert_eq!(alive(&pool, past_noon.id).await, 0);
    assert_eq!(alive(&pool, today.id).await, 1, "今天的截止还没过期");
    assert_eq!(alive(&pool, future.id).await, 1);
    assert_eq!(alive(&pool, undated.id).await, 1, "没截止时间的永不过期");
    assert_eq!(
        alive(&pool, remind_only.id).await,
        1,
        "只有开始时间（没有截止承诺）的不算过期"
    );
    assert_eq!(alive(&pool, done.id).await, 1, "已完成的不清");

    // 幂等：再跑一次不再删（0 条）
    assert_eq!(todo::purge_overdue(&pool, today_start).await.unwrap(), 0);
    assert!(
        todo::list(&pool, TodoListParams::default())
            .await
            .unwrap()
            .iter()
            .all(|t| t.id != past.id),
        "清掉的待办不出现在列表里"
    );
}

#[tokio::test]
async fn purge_keeps_todo_moved_to_today() {
    let pool = fresh_pool("todo-purge-moved").await;
    let today_start = 1_700_000_000_000;
    let t = todo::create(
        &pool,
        "改期到今天的",
        None,
        Some(today_start - 3_600_000),
        None,
    )
    .await
    .unwrap();

    // 用户把截止改到今天 → 不该被清
    let patch = TodoPatch {
        planned_at: Some(Some(today_start + DAY / 2)),
        ..Default::default()
    };
    todo::update(&pool, t.id, patch).await.unwrap();

    assert_eq!(todo::purge_overdue(&pool, today_start).await.unwrap(), 0);
    assert_eq!(alive(&pool, t.id).await, 1);
}
