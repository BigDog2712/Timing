//! 待办 → 计时（V0.3.12 / ADR-030）：开始即移出待办区、按标题映射事项、计时中拒绝。
//!
//! 用户口径：「待办事项开始计时后自动挪至计时区，不再在待办区」——所以软删除挂在**开始**上，
//! 而 `timer::stop` 里的同名清理仍然服务「手动起了同名事项」的旧路径（见 timer_todo_link.rs）。

use crate::error::ErrorCode;
use crate::models::enums::timer_status;
use crate::models::todo::TodoListParams;
use crate::services::{timer, todo, todo_start};
use crate::tests::support::{expect_err, fresh_pool, new_item, scalar_i64};

#[tokio::test]
async fn start_moves_todo_out_of_pending_list() {
    let pool = fresh_pool("todo-start").await;
    let t = todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();

    let record = todo_start::start(&pool, t.id).await.unwrap();
    assert_eq!(record.status, "active");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE name = '写周报'").await,
        1,
        "没有同名事项时应按标题建一条"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT deleted_at IS NOT NULL FROM todos WHERE id = {}",
                t.id
            )
        )
        .await,
        1,
        "开始计时即软删这条待办"
    );
    assert!(
        todo::list(&pool, TodoListParams::default())
            .await
            .unwrap()
            .is_empty(),
        "待办区里不该再看到它"
    );
    let state = timer::state(&pool).await.unwrap();
    assert_eq!(state.status, timer_status::RUNNING);
    assert_eq!(state.session.unwrap().item_id, record.item_id);
}

#[tokio::test]
async fn start_reuses_item_with_same_name() {
    let pool = fresh_pool("todo-start-reuse").await;
    let item_id = new_item(&pool, "写周报").await;
    let t = todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();

    let record = todo_start::start(&pool, t.id).await.unwrap();
    assert_eq!(record.item_id, item_id, "同名事项应复用，不重复建");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE name = '写周报'").await,
        1
    );
}

#[tokio::test]
async fn start_rejects_while_timer_running() {
    let pool = fresh_pool("todo-start-busy").await;
    let first = todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();
    todo_start::start(&pool, first.id).await.unwrap();

    let second = todo::create(&pool, "取快递", None, None, None)
        .await
        .unwrap();
    let code = expect_err(todo_start::start(&pool, second.id).await);
    assert_eq!(code, ErrorCode::TimerAlreadyRunning);
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT deleted_at IS NULL FROM todos WHERE id = {}",
                second.id
            )
        )
        .await,
        1,
        "被拒时不该动待办"
    );
}

#[tokio::test]
async fn start_rejects_unknown_or_done_todo() {
    let pool = fresh_pool("todo-start-missing").await;
    assert_eq!(
        expect_err(todo_start::start(&pool, 4242).await),
        ErrorCode::TodoNotFound
    );

    let done = todo::create(&pool, "已完成的", None, None, None)
        .await
        .unwrap();
    todo::toggle(&pool, done.id, true).await.unwrap();
    assert_eq!(
        expect_err(todo_start::start(&pool, done.id).await),
        ErrorCode::TodoNotFound,
        "已完成的待办不再变成计时"
    );
}

#[tokio::test]
async fn after_stop_starts_the_consented_todo() {
    let pool = fresh_pool("todo-autostart").await;
    let first = todo::create(&pool, "写周报", None, None, None)
        .await
        .unwrap();
    let record = todo_start::start(&pool, first.id).await.unwrap();
    crate::tests::support::allow_short_records(&pool).await;
    crate::tests::support::rewind(&pool, record.id, 2_000).await;

    // 用户答应「结束后自动开始」
    let next = todo::create(&pool, "取快递", None, None, Some(1_700_000_000_000))
        .await
        .unwrap();
    let patch = crate::models::todo::TodoPatch {
        auto_start: Some(true),
        ..Default::default()
    };
    todo::update(&pool, next.id, patch).await.unwrap();

    timer::stop(&pool).await.unwrap();
    let state = timer::state(&pool).await.unwrap();
    assert_eq!(
        state.status,
        timer_status::RUNNING,
        "会话结束后应顶上那条待办"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT deleted_at IS NOT NULL FROM todos WHERE id = {}",
                next.id
            )
        )
        .await,
        1,
        "被自动开始时也要移出待办区"
    );
}
