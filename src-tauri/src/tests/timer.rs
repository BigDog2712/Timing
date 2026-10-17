//! 计时状态机（Spec §9 AC-02~07；IPC-CONTRACT-v2 §4.2）。
//! 覆盖：start/pause/resume/stop/undo_stop 迁移、单 active 约束、accumulated_sec 计算、幂等语义。
//! 换事项 switch / 周期落盘 flush / 崩溃恢复 resolve_open 见同目录 `timer_switch.rs`。

use sqlx::SqlitePool;

use crate::error::ErrorCode;
use crate::models::constants::{SYSTEM_ITEM_ID, UNDO_TOLERANCE_MS, UNDO_WINDOW_MS};
use crate::services::timer;
use crate::tests::support::{count_active, exec, expect_err, fresh_pool, new_item, scalar_i64};

/// 把会话的 started_at / running_since 同步回拨 ms 毫秒（running_since 为 NULL 时保持 NULL）。
async fn rewind(pool: &SqlitePool, id: i64, ms: i64) {
    exec(
        pool,
        &format!(
            "UPDATE time_records \
             SET started_at = started_at - {ms}, running_since = running_since - {ms} \
             WHERE id = {id}"
        ),
    )
    .await;
}

#[tokio::test]
async fn stop_soft_deletes_matching_pending_todos_only_after_save() {
    let pool = fresh_pool("timer-todo-link").await;
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

#[tokio::test]
async fn start_creates_running_active_session() {
    let pool = fresh_pool("timer-start").await;
    let rec = timer::start(&pool, None).await.unwrap();

    assert_eq!(rec.item_id, SYSTEM_ITEM_ID, "无事项时归属「未归类」");
    assert_eq!(rec.status, "active");
    assert_eq!(rec.accumulated_sec, 0);
    assert!(rec.ended_at.is_none());
    assert_eq!(
        rec.running_since,
        Some(rec.started_at),
        "开始时 running_since=started_at"
    );
    assert_eq!(count_active(&pool).await, 1);

    let st = timer::state(&pool).await.unwrap();
    assert_eq!(st.status, "running");
    assert!(st.session.is_some());
    assert_eq!(
        st.last_item_id,
        Some(SYSTEM_ITEM_ID),
        "lastItemId 应持久化为当前事项"
    );
}

#[tokio::test]
async fn start_second_session_rejected() {
    let pool = fresh_pool("timer-start-twice").await;
    timer::start(&pool, Some(1)).await.unwrap();
    let code = expect_err(timer::start(&pool, Some(1)).await);
    assert_eq!(code, ErrorCode::TimerAlreadyRunning);
    assert_eq!(count_active(&pool).await, 1, "单 active 约束");
}

#[tokio::test]
async fn start_unknown_item_rejected() {
    let pool = fresh_pool("timer-start-unknown").await;
    let code = expect_err(timer::start(&pool, Some(9999)).await);
    assert_eq!(code, ErrorCode::ItemNotFound);
    assert_eq!(count_active(&pool).await, 0, "失败不应留下 active");
}

#[tokio::test]
async fn pause_freezes_accumulated_and_creates_no_record() {
    let pool = fresh_pool("timer-pause").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 2_500).await;

    let paused = timer::pause(&pool).await.unwrap();
    assert_eq!(paused.status, "active", "暂停仍 active，不结束会话");
    assert!(paused.running_since.is_none(), "暂停后 running_since=NULL");
    assert_eq!(paused.accumulated_sec, 2, "floor(2500ms/1000)=2");
    assert_eq!(count_active(&pool).await, 1);
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM time_records").await,
        1,
        "暂停不得产生任何新记录（AC-03）"
    );
    assert_eq!(timer::state(&pool).await.unwrap().status, "paused");
}

#[tokio::test]
async fn pause_negative_delta_clamped_to_zero() {
    let pool = fresh_pool("timer-pause-neg").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    // running_since 置于未来 → 负增量应按 0 处理（floor_sec 钳制）
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET running_since = running_since + 10000 WHERE id = {}",
            rec.id
        ),
    )
    .await;
    let paused = timer::pause(&pool).await.unwrap();
    assert_eq!(paused.accumulated_sec, 0);
}

#[tokio::test]
async fn pause_when_idle_rejected() {
    let pool = fresh_pool("timer-pause-idle").await;
    assert_eq!(
        expect_err(timer::pause(&pool).await),
        ErrorCode::TimerNotRunning
    );
}

#[tokio::test]
async fn pause_when_paused_is_idempotent() {
    let pool = fresh_pool("timer-pause-idem").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 3_000).await;
    let p1 = timer::pause(&pool).await.unwrap();
    let p2 = timer::pause(&pool).await.expect("重复 pause 应幂等不报错");
    assert_eq!(
        p2.accumulated_sec, p1.accumulated_sec,
        "再次 pause 不改动累计"
    );
    assert!(p2.running_since.is_none());
    assert_eq!(count_active(&pool).await, 1);
}

#[tokio::test]
async fn resume_sets_running_since() {
    let pool = fresh_pool("timer-resume").await;
    timer::start(&pool, Some(1)).await.unwrap();
    timer::pause(&pool).await.unwrap();
    let resumed = timer::resume(&pool).await.unwrap();
    assert!(resumed.running_since.is_some(), "继续后 running_since=now");
    assert_eq!(timer::state(&pool).await.unwrap().status, "running");
}

#[tokio::test]
async fn resume_when_idle_rejected() {
    let pool = fresh_pool("timer-resume-idle").await;
    assert_eq!(
        expect_err(timer::resume(&pool).await),
        ErrorCode::TimerNotRunning
    );
}

#[tokio::test]
async fn resume_when_running_is_idempotent() {
    let pool = fresh_pool("timer-resume-idem").await;
    timer::start(&pool, Some(1)).await.unwrap();
    let before = timer::state(&pool)
        .await
        .unwrap()
        .session
        .unwrap()
        .running_since;
    let resumed = timer::resume(&pool)
        .await
        .expect("运行态 resume 应幂等不报错");
    assert_eq!(resumed.running_since, before, "已运行态不改动起点");
    assert_eq!(count_active(&pool).await, 1);
}

#[tokio::test]
async fn stop_saves_and_freezes_accumulated() {
    let pool = fresh_pool("timer-stop").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 5_000).await;

    let stopped = timer::stop(&pool).await.unwrap();
    assert_eq!(stopped.status, "saved");
    assert!(stopped.running_since.is_none());
    assert_eq!(stopped.accumulated_sec, 5, "结束冻结 accumulated");
    assert!(
        stopped.ended_at.unwrap() >= stopped.started_at,
        "时间不变式"
    );
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
    assert_eq!(count_active(&pool).await, 0);
}

#[tokio::test]
async fn stop_when_idle_rejected() {
    let pool = fresh_pool("timer-stop-idle").await;
    assert_eq!(
        expect_err(timer::stop(&pool).await),
        ErrorCode::TimerNotRunning
    );
}

#[tokio::test]
async fn undo_within_window_reactivates_and_continues() {
    let pool = fresh_pool("timer-undo").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    rewind(&pool, rec.id, 4_000).await;
    let stopped = timer::stop(&pool).await.unwrap();
    assert_eq!(stopped.accumulated_sec, 4);

    let back = timer::undo(&pool, stopped.id).await.unwrap();
    assert_eq!(back.status, "active");
    assert!(back.ended_at.is_none(), "撤销后 ended_at=null");
    assert!(back.running_since.is_some(), "回到 RUNNING");
    assert_eq!(back.accumulated_sec, 4, "累计时长接续");
    assert_eq!(timer::state(&pool).await.unwrap().status, "running");
    assert_eq!(count_active(&pool).await, 1);
}

#[tokio::test]
async fn undo_expired_rejected() {
    let pool = fresh_pool("timer-undo-exp").await;
    timer::start(&pool, Some(1)).await.unwrap();
    let stopped = timer::stop(&pool).await.unwrap();
    // 把 started_at/ended_at 一起回拨超过窗口，保持 ended>=started
    let back = UNDO_WINDOW_MS + UNDO_TOLERANCE_MS + 5_000;
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET started_at = started_at - {back}, ended_at = ended_at - {back} \
             WHERE id = {}",
            stopped.id
        ),
    )
    .await;
    assert_eq!(
        expect_err(timer::undo(&pool, stopped.id).await),
        ErrorCode::TimerNoUndo
    );
    // 记录保持 saved（AC-07）
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM time_records WHERE id={} AND status='saved'",
                stopped.id
            )
        )
        .await,
        1
    );
}

#[tokio::test]
async fn undo_blocked_when_a_new_session_is_active() {
    let pool = fresh_pool("timer-undo-race").await;
    let item2 = new_item(&pool, "乙").await;
    let a = timer::start(&pool, Some(1)).await.unwrap();
    timer::stop(&pool).await.unwrap();
    timer::start(&pool, Some(item2)).await.unwrap(); // 新会话 active（R-1 竞态）

    assert_eq!(
        expect_err(timer::undo(&pool, a.id).await),
        ErrorCode::TimerAlreadyRunning
    );
    assert_eq!(count_active(&pool).await, 1, "绝不能出现两条 active");
}

#[tokio::test]
async fn undo_non_saved_record_rejected() {
    let pool = fresh_pool("timer-undo-nonsaved").await;
    let a = timer::start(&pool, Some(1)).await.unwrap(); // 仍 active
    assert_eq!(
        expect_err(timer::undo(&pool, a.id).await),
        ErrorCode::TimerNoUndo
    );
}
