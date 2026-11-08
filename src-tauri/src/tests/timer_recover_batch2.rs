//! 批 2（V0.11.24）异常退出恢复的后端判据：H2 / H3（跨零点）/ H5 + 托盘退出 ② 收尾。
//!
//! 口径：**关闭时间 = `running_since`**（最后一次落盘锚点）。「结束在关闭时间」意味着
//! `ended_at` 落在关闭那一刻（跨零点归关闭那一天），累计保持最后落盘值、不并入空档。

use chrono::{Datelike, Local, TimeZone};

use crate::models::enums::ResolveAction;
use crate::platform::clock::now_ms;
use crate::repositories::record_session as session;
use crate::services::{timer, timer_recover};
use crate::tests::support::{exec, fresh_pool, scalar_i64};

/// 本地 `y-m-d h:min` 的毫秒时间戳（测试只在自己的时区里跑，不假设 UTC）。
fn at(y: i32, m: u32, d: u32, h: u32, min: u32) -> i64 {
    Local.with_ymd_and_hms(y, m, d, h, min, 0)
        .earliest()
        .expect("合法本地时刻")
        .timestamp_millis()
}

/// 把会话推到「`ago_ms` 前开始并最后落盘、跑了 42 秒后崩溃」。
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

/* ---------------- H2：一直算到现在 ---------------- */

#[tokio::test]
async fn h2_resume_keeps_active_with_ended_at_null() {
    let pool = fresh_pool("recover-b2-h2").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, 600_000, true).await;

    let out = timer::resolve_open(&pool, ResolveAction::Resume, None, true)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.status, "active", "选「一直算到现在」后仍在计时");
    assert_eq!(out.ended_at, None, "继续计时：ended_at 必须为空（H2）");
    /* 42 + 600 秒空档 = 642；留 2 秒余量给测试自身耗时。 */
    assert!(
        (642..=644).contains(&out.accumulated_sec),
        "含空档的连续累计，实际 {}",
        out.accumulated_sec
    );
}

/* ---------------- H3：结束在关闭时间（跨零点） ---------------- */

#[tokio::test]
async fn h3_close_lands_ended_at_on_close_time_across_midnight() {
    let pool = fresh_pool("recover-b2-h3-midnight").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    /* 跨零点用例（判据 H3 原文）：昨天 23:50 开始 → 今天 08:00 关闭 → ended_at 落 08:00 那天。 */
    let today = Local::now().date_naive();
    let yesterday = today.pred_opt().expect("date_pred");
    let start_at = at(yesterday.year(), yesterday.month(), yesterday.day(), 23, 50);
    let close_at = at(today.year(), today.month(), today.day(), 8, 0);
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET started_at = {start_at}, running_since = {close_at}, \
             accumulated_sec = 42 WHERE id = {}",
            rec.id
        ),
    )
    .await;

    let out = timer::resolve_open(&pool, ResolveAction::Close, Some(close_at), false)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.status, "saved");
    assert_eq!(
        out.ended_at,
        Some(close_at),
        "ended_at 落在关闭那一刻（08:00 那天），不是「现在」"
    );
    assert_eq!(
        out.accumulated_sec, 42,
        "按关闭时间结束不并入空档：累计 = 关闭时刻 − 开始时刻的最后落盘值"
    );
    assert_eq!(timer::state(&pool).await.unwrap().status, "idle");
}

/* ---------------- H5：多条 active 脏数据 ---------------- */

#[tokio::test]
async fn h5_extra_actives_closed_and_zero_left_after_resolve() {
    let pool = fresh_pool("recover-b2-h5").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, 600_000, true).await;
    /* 造第二条脏 active：唯一索引会拦，先摘掉（现实中的脏数据正是索引缺位年代的遗留）。
       它比 rec 晚开始——弹框只该针对最早的 rec。 */
    exec(&pool, "DROP INDEX uq_records_open").await;
    let extra_start = now_ms() - 300_000;
    let now = now_ms();
    exec(
        &pool,
        &format!(
            "INSERT INTO time_records \
             (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at) \
             VALUES (1, 'active', {extra_start}, NULL, 7, {extra_start}, {now}, {now})"
        ),
    )
    .await;

    /* find_active（弹框的数据源）必须取最早那条（边界②）。 */
    let earliest = session::find_active(&pool).await.unwrap().unwrap();
    assert_eq!(earliest.id, rec.id, "只针对 started_at 最早的一条弹框");

    let close_at = now_ms() - 600_000;
    let out = timer::resolve_open(&pool, ResolveAction::Close, Some(close_at), false)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(out.id, rec.id, "用户的选择作用在最早那条上");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM time_records WHERE status = 'active'").await,
        0,
        "选完 active 必须为 0（H5）"
    );
    /* 第二条被按它自己的关闭时间结束（extra 的 running_since = extra_start）。 */
    let extra_ended = scalar_i64(
        &pool,
        &format!("SELECT ended_at FROM time_records WHERE id = {}", rec.id + 1),
    )
    .await;
    assert_eq!(extra_ended, extra_start, "多余的 active 按关闭时间结束");
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT accumulated_sec FROM time_records WHERE id = {}", rec.id + 1)
        )
        .await,
        7,
        "收尾不并入空档"
    );
}

/* ---------------- 托盘退出 ② 位收尾 ---------------- */

#[tokio::test]
async fn quit_close_out_lands_ended_at_on_close_time() {
    let pool = fresh_pool("recover-b2-quit-running").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    /* 显式落一个固定 running_since：断言要比对同一个值，不吃两次 now_ms() 的毫秒漂移。 */
    let close_at = now_ms() - 600_000;
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET accumulated_sec = 42, started_at = {close_at}, \
             running_since = {close_at} WHERE id = {}",
            rec.id
        ),
    )
    .await;

    let closed = timer_recover::close_active_for_quit(&pool).await.unwrap();
    assert_eq!(closed, 1, "退出时收尾 1 条 active");
    let out = timer::state(&pool).await.unwrap();
    assert_eq!(out.status, "idle", "收尾后没有 active 会话");
    let ended_at =
        scalar_i64(&pool, &format!("SELECT ended_at FROM time_records WHERE id = {}", rec.id)).await;
    assert_eq!(
        ended_at, close_at,
        "退出收尾的 ended_at = 关闭时间（running_since），不是退出那一刻的 now"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            &format!("SELECT accumulated_sec FROM time_records WHERE id = {}", rec.id)
        )
        .await,
        42
    );
}

#[tokio::test]
async fn quit_close_out_paused_keeps_accumulated_and_uses_now() {
    let pool = fresh_pool("recover-b2-quit-paused").await;
    let rec = timer::start(&pool, Some(1)).await.unwrap();
    crash_after(&pool, rec.id, 600_000, false).await;

    let closed = timer_recover::close_active_for_quit(&pool).await.unwrap();
    assert_eq!(closed, 1);
    let ended_at = scalar_i64(&pool, &format!("SELECT ended_at FROM time_records WHERE id = {}", rec.id)).await;
    assert!(
        ended_at >= now_ms() - 2_000,
        "暂停中没有关闭时刻可考，ended_at 取 now（不编造）"
    );
    assert_eq!(
        scalar_i64(&pool, &format!("SELECT accumulated_sec FROM time_records WHERE id = {}", rec.id)).await,
        42,
        "暂停中收尾不改动累计"
    );
}
