//! 强制退出后的「退出期间」处理（V0.4.2，用户口径）。
//!
//! 背景：`resolve_open` 原本只认 R-2「应用关着就停表」——重启后继续计时从头累加，
//! 结束并保存也只认最后一次落盘的 `accumulated_sec`。用户要求「可选择退出期间是否
//! 并入计时」，于是多了一个 `include_gap` 开关。本文件把这个开关的四种组合钉死：
//!
//! | 场景 | include_gap | 期望 |
//! | --- | --- | --- |
//! | 继续计时 | false | 空档不补（R-2 原口径） |
//! | 继续计时 | true | 空档补进 accumulated，running_since 仍重置为 now |
//! | 结束并保存 | true | 空档补到 end_at 为止，然后落库 |
//! | 暂停中 | true | **不补**——没有流逝，补了等于把暂停时间算成工作 |
//!
//! 断言只用区间（`>=` / `<`），不钉死到秒：`now_ms()` 在测试执行中会往前走。

use crate::models::enums::ResolveAction;
use crate::platform::clock::now_ms;
use crate::services::timer;
use crate::tests::support::{exec, fresh_pool, safe_rewind_ms, scalar_i64};

/// 把会话推到「1 小时前开始、跑了 42 秒后崩溃」：`running_since` 就是最后落盘点。
async fn crash_after(pool: &sqlx::SqlitePool, id: i64, ago_ms: i64, running: bool) {
    let past = now_ms() - ago_ms;
    let running_since = if running {
        past.to_string()
    } else {
        "NULL".to_string()
    };
    exec(
        pool,
        &format!(
            "UPDATE time_records SET accumulated_sec = 42, started_at = {past}, \
             running_since = {running_since} WHERE id = {id}"
        ),
    )
    .await;
}

#[tokio::test]
async fn resume_without_gap_keeps_r2() {
    let Some(back) = safe_rewind_ms(600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-resume-off").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, true).await;

    let out = timer::resolve_open(&pool, ResolveAction::Resume, None, false)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.accumulated_sec, 42, "没勾就不补空档（R-2）");
    assert_eq!(out.status, "active");
}

#[tokio::test]
async fn resume_with_gap_credits_the_whole_absence() {
    let Some(back) = safe_rewind_ms(600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-resume-on").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, true).await;

    let out = timer::resolve_open(&pool, ResolveAction::Resume, None, true)
        .await
        .unwrap()
        .unwrap();
    /* 42 + 空档；留 2 秒余量给测试自身的耗时。 */
    let want = 42 + back / 1000;
    assert!(
        (want..=want + 2).contains(&out.accumulated_sec),
        "勾了要补上 {} 秒空档，实际 {}",
        back / 1000,
        out.accumulated_sec
    );
    assert_eq!(out.status, "active");
    assert!(
        out.running_since.unwrap() >= now_ms() - 2_000,
        "继续之后 running_since 必须是 now，不能停在崩溃点（否则下一轮 flush 会重复计）"
    );
}

#[tokio::test]
async fn close_with_gap_counts_up_to_the_end_time() {
    let Some(back) = safe_rewind_ms(3_600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-close-on").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, true).await;

    let out = timer::resolve_open(&pool, ResolveAction::Close, None, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.status, "saved");
    let want = 42 + back / 1000;
    assert!(
        (want..=want + 2).contains(&out.accumulated_sec),
        "结束并保存也要补空档（42 + {}），实际 {}",
        back / 1000,
        out.accumulated_sec
    );
    assert!(out.running_since.is_none());
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
}

#[tokio::test]
async fn close_with_gap_honors_explicit_end_at() {
    let Some(back) = safe_rewind_ms(600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-close-endat").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, true).await;
    /* 用户把结束时刻往前挪：空档只该补到 end，不该补到 now。 */
    let end_back = back.min(300_000);
    let end = now_ms() - end_back;

    let out = timer::resolve_open(&pool, ResolveAction::Close, Some(end), true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.ended_at, Some(end));
    let want = 42 + end_back / 1000;
    assert!(
        (want..=want + 2).contains(&out.accumulated_sec),
        "空档以 end_at 为界（42 + {}），实际 {}",
        end_back / 1000,
        out.accumulated_sec
    );
}

#[tokio::test]
async fn gap_is_never_credited_for_a_paused_session() {
    let Some(back) = safe_rewind_ms(3_600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-paused").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, false).await;

    let closed = timer::resolve_open(&pool, ResolveAction::Close, None, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        closed.accumulated_sec, 42,
        "暂停中崩溃时没有流逝，勾了也不该补"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT COUNT(*) FROM time_records WHERE id={} AND status='saved'",
                rec.id
            )
        )
        .await,
        1
    );
}

#[tokio::test]
async fn discard_ignores_gap_and_frees_the_slot() {
    let Some(back) = safe_rewind_ms(3_600_000) else {
        return;
    };
    let pool = fresh_pool("recover-gap-discard").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, back, true).await;

    let out = timer::resolve_open(&pool, ResolveAction::Discard, None, true)
        .await
        .unwrap();
    assert!(out.is_none(), "discard 返回 null");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!(
                "SELECT accumulated_sec FROM time_records WHERE id={} AND deleted_at IS NOT NULL",
                rec.id
            )
        )
        .await,
        42,
        "丢弃的记录不补空档——记录本身都不要了"
    );
}
