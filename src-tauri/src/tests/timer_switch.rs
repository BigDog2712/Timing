//! 计时状态机续（Spec §9 AC-12 / AC-14；IPC-CONTRACT-v2 §4.2 / §7 / §10）。
//! 覆盖：换事项 switch（分段 / 仅改归属）、周期落盘 flush、崩溃恢复 resolve_open 三选一
//! （含 discard 释放唯一槽 R-5）。开始 / 暂停 / 结束 / 撤销见同目录 `timer.rs`。

use crate::error::ErrorCode;
use crate::infra::clock::now_ms;
use crate::models::enums::{ResolveAction, SwitchMode};
use crate::services::timer;
use crate::tests::support::{count_active, exec, expect_err, fresh_pool, new_item, scalar_i64};

#[tokio::test]
async fn switch_just_switch_keeps_timing_continuous() {
    let pool = fresh_pool("timer-switch-just").await;
    let item2 = new_item(&pool, "乙").await;
    timer::start(&pool, Some(1)).await.unwrap();
    let before = timer::state(&pool).await.unwrap().session.unwrap();

    let st = timer::switch(&pool, item2, SwitchMode::JustSwitch)
        .await
        .unwrap();
    let after = st.session.unwrap();
    assert_eq!(after.item_id, item2, "仅改归属");
    assert_eq!(after.running_since, before.running_since, "时长连续不计断");
    assert_eq!(count_active(&pool).await, 1);
}

#[tokio::test]
async fn switch_end_and_start_segments() {
    let pool = fresh_pool("timer-switch-seg").await;
    let item2 = new_item(&pool, "乙").await;
    timer::start(&pool, Some(1)).await.unwrap();

    let st = timer::switch(&pool, item2, SwitchMode::EndAndStart)
        .await
        .unwrap();
    assert_eq!(st.status, "running");
    assert_eq!(st.session.as_ref().unwrap().item_id, item2);
    assert_eq!(count_active(&pool).await, 1);
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE item_id=1 AND status='saved'"
        )
        .await,
        1,
        "旧会话应被分段置 saved"
    );
}

#[tokio::test]
async fn switch_unknown_item_rejected() {
    let pool = fresh_pool("timer-switch-unknown").await;
    timer::start(&pool, Some(1)).await.unwrap();
    let code = expect_err(timer::switch(&pool, 9999, SwitchMode::JustSwitch).await);
    assert_eq!(code, ErrorCode::ItemNotFound);
}

#[tokio::test]
async fn switch_when_idle_rejected() {
    let pool = fresh_pool("timer-switch-idle").await;
    assert_eq!(
        expect_err(timer::switch(&pool, 1, SwitchMode::JustSwitch).await),
        ErrorCode::TimerNotRunning
    );
}

#[tokio::test]
async fn flush_advances_accumulated_then_noop() {
    let pool = fresh_pool("timer-flush").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET running_since = running_since - 7000 WHERE id = {}",
            rec.id
        ),
    )
    .await;

    timer::flush_active(&pool).await.unwrap();
    let a1 = scalar_i64(
        &pool,
        &format!(
            "SELECT accumulated_sec FROM time_records WHERE id={}",
            rec.id
        ),
    )
    .await;
    assert_eq!(a1, 7, "周期落盘把已计秒折入 accumulated_sec");

    timer::flush_active(&pool).await.unwrap();
    let a2 = scalar_i64(
        &pool,
        &format!(
            "SELECT accumulated_sec FROM time_records WHERE id={}",
            rec.id
        ),
    )
    .await;
    assert_eq!(a2, 7, "delta<=0 时落盘为 no-op（不重复累加）");
}

#[tokio::test]
async fn resolve_resume_resets_running_since_without_gap() {
    let pool = fresh_pool("timer-resume-gap").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    let past = now_ms() - 3_600_000;
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET accumulated_sec = 42, started_at = {past}, running_since = {past} \
             WHERE id = {}",
            rec.id
        ),
    )
    .await;

    let out = timer::resolve_open(&pool, ResolveAction::Resume, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.status, "active");
    assert_eq!(
        out.accumulated_sec, 42,
        "resume 不把崩溃停机时长计入（R-2）"
    );
    assert!(
        out.running_since.unwrap() > past + 1_000,
        "running_since 重置为 now"
    );
    assert_eq!(timer::state(&pool).await.unwrap().status, "running");
}

#[tokio::test]
async fn resolve_close_uses_last_flushed_without_gap() {
    let pool = fresh_pool("timer-close-gap").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    let past = now_ms() - 3_600_000;
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET accumulated_sec = 42, started_at = {past}, running_since = {past} \
             WHERE id = {}",
            rec.id
        ),
    )
    .await;

    let out = timer::resolve_open(&pool, ResolveAction::Close, None)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.status, "saved");
    assert_eq!(
        out.accumulated_sec, 42,
        "以最后落盘为准，不补算崩溃间隙（丢失≤30s）"
    );
    assert!(out.running_since.is_none());
    assert!(out.ended_at.unwrap() >= past);
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
}

#[tokio::test]
async fn resolve_close_honors_explicit_end_at() {
    let pool = fresh_pool("timer-close-endat").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    let past = now_ms() - 100_000;
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET started_at = {past}, running_since = {past} WHERE id = {}",
            rec.id
        ),
    )
    .await;
    let end = now_ms() - 50_000;

    let out = timer::resolve_open(&pool, ResolveAction::Close, Some(end))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.ended_at, Some(end));
}

#[tokio::test]
async fn resolve_close_end_before_start_rejected() {
    let pool = fresh_pool("timer-close-bad-end").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    let bad_end = rec.started_at - 1;
    assert_eq!(
        expect_err(timer::resolve_open(&pool, ResolveAction::Close, Some(bad_end)).await),
        ErrorCode::InvalidDuration
    );
}

#[tokio::test]
async fn resolve_discard_frees_single_active_slot() {
    let pool = fresh_pool("timer-discard").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();

    let out = timer::resolve_open(&pool, ResolveAction::Discard, None)
        .await
        .unwrap();
    assert!(out.is_none(), "discard 返回 null");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM time_records WHERE id={} AND status='saved' AND deleted_at IS NOT NULL",
                rec.id
            )
        )
        .await,
        1,
        "discard 必须置 saved + 软删除（R-5）"
    );
    assert_eq!(count_active(&pool).await, 0);
    // 唯一槽已释放：随后可正常开新会话
    let again = timer::start(&pool, Some(1))
        .await
        .expect("discard 后应能开新会话（R-5）");
    assert_eq!(again.status, "active");
}

#[tokio::test]
async fn resolve_without_active_session_is_none() {
    let pool = fresh_pool("timer-resolve-none").await;
    assert!(timer::resolve_open(&pool, ResolveAction::Resume, None)
        .await
        .unwrap()
        .is_none());
    assert!(timer::resolve_open(&pool, ResolveAction::Discard, None)
        .await
        .unwrap()
        .is_none());
}
