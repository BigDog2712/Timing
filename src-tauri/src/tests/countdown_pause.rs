//! 倒计时的**暂停语义**判据（2026-11-16，评审 P1-3）。
//!
//! 从 `tests/countdown.rs` 拆出（单文件 ≤300 行）。两条用例对应同一个缺陷：
//! 到点是用 `live_duration` 判的（**不计暂停**），而落档曾经用
//! `started_at + target`（隐含「一直在跑」）。中途暂停过之后两个口径就分叉 ——
//! 结束时刻比真实早一段暂停时长，跨零点时连记录的日期都错。
//!
//! 口径与实现见 `services/timer_time.rs::countdown_end_at`。

use crate::services::{countdown, timer};
use crate::tests::countdown::rewind;
use crate::tests::support::{count_active, exec, fresh_pool};

/// [评审 P1-3] 暂停过之后，`ended_at` 必须是**恢复后满 target** 的那一刻。
///
/// 原文口径 `ended_at = started_at + target*1000` 隐含「一直在跑」，而到点是用
/// `live_duration` 判的（不计暂停）。这条用例跑的就是评审描述的场景：
/// 跑 30 秒 → 暂停 1 小时 → 恢复再跑 30 秒（60 秒倒计时）。
///
/// 老代码会把记录写成「开始后 1 分钟」——比真实结束早 1 小时；跨零点时连归属的日期都会错。
/// 现在必须落在恢复点之后（`ended_at - started_at ≈ 3630s`）。
#[tokio::test]
async fn tick_after_pause_ends_at_the_resumed_moment() {
    let pool = fresh_pool("cd-pause-end").await;
    let rec = countdown::start(&pool, Some(1), 60).await.unwrap();

    /* ① 跑 30 秒。 */
    rewind(&pool, rec.id, 30_000).await;
    assert!(countdown::tick(&pool).await.unwrap().is_none(), "还没到点");

    /* ② 暂停：`accumulated_sec` 记 30，`running_since` 清空。 */
    timer::pause(&pool).await.unwrap();
    let paused = timer::state(&pool).await.unwrap();
    assert_eq!(paused.live_duration_sec, 30);
    assert_eq!(paused.status, "paused");

    /* ③ 让暂停持续 1 小时：running_since 为空，只有 started_at 被推回去，
    于是「墙钟跨度」比「已跑时长」多出一小时 —— 两个口径的分叉点就在这里。 */
    rewind(&pool, rec.id, 3_600_000).await;

    /* ④ 恢复再跑 30 秒 → 累计满 60，到点。 */
    timer::resume(&pool).await.unwrap();
    rewind(&pool, rec.id, 30_000).await;
    let fired = countdown::tick(&pool)
        .await
        .unwrap()
        .expect("累计满 target 必须到点");

    let ended_at = fired.record.ended_at.expect("已结束必须有 ended_at");
    let span = ended_at - fired.record.started_at;
    assert_eq!(fired.record.accumulated_sec, 60, "时长仍是 target");
    assert!(
        span >= 3_600_000,
        "结束时刻必须落在暂停之后（墙钟跨度 ≈ 1 小时 + 1 分钟），实际 {span}ms —— \
         落成 60000 就说明还在用 `started_at + target` 那个旧口径"
    );
    assert!(
        span <= 3_600_000 + 120_000,
        "但也不该偏离太多（多出来的只能是暂停时长 + 两次 tick 的抖动），实际 {span}ms"
    );
    assert_eq!(count_active(&pool).await, 0);
}

/// [评审 P1-3] 跨零点的倒计时按**真实到点时刻**拆天，而不是「开始后 target 秒」。
///
/// 形状：会话从**昨天 23:00** 开始、已跑 10 分钟，暂停很久之后在 10 分钟前恢复，
/// 再跑 10 分钟到点（target 20 分钟）。真实到点就是「现在」（今天），所以整段要按
/// 零点拆成两条：昨天 23:00–24:00 与今天 00:00–现在。
///
/// 旧口径算出的到点是「昨天 23:20」——整段都落在昨天，今天一条都没有。判据是
/// 「必须存在一条属于今天的记录」，它只在 `ended_at` 用真实到点时刻时才成立。
#[tokio::test]
async fn tick_after_pause_splits_on_the_real_end_moment() {
    use chrono::{Duration, Local, TimeZone};

    let pool = fresh_pool("cd-pause-crossday").await;
    let rec = countdown::start(&pool, Some(1), 1_200).await.unwrap();

    let now = crate::platform::clock::now_ms();
    let today = Local
        .timestamp_millis_opt(now)
        .earliest()
        .expect("本机时间可解释")
        .date_naive();
    let yesterday_23 = (today - Duration::days(1))
        .and_hms_opt(23, 0, 0)
        .expect("昨天 23:00 合法")
        .and_local_timezone(Local)
        .single()
        .expect("本地时区可定位")
        .timestamp_millis();
    let today_00 = today
        .and_hms_opt(0, 0, 0)
        .expect("今天 00:00 合法")
        .and_local_timezone(Local)
        .single()
        .expect("本地时区可定位")
        .timestamp_millis();

    /* 直接摆好状态：昨天 23:00 开始、已跑 10 分钟、10 分钟前刚恢复。
    手改而不是走 pause/resume，是因为这里要的是「跨零点的形状」，
    暂停语义本身由上一条用例覆盖。 */
    exec(
        &pool,
        &format!(
            "UPDATE time_records SET started_at = {yesterday_23}, accumulated_sec = 600, \
             running_since = {} WHERE id = {}",
            now - 600_000,
            rec.id
        ),
    )
    .await;

    let fired = countdown::tick(&pool)
        .await
        .unwrap()
        .expect("累计满 target 必须到点");
    assert!(fired.ended, "到点恒结束");

    /* 拆天之后：两条记录、总和仍是 target、且有一条落在今天。
    （拆开后**没有哪一行**还等于 target —— 秒数是按墙钟占比分的，所以这里只能查总和。） */
    let rows: Vec<(i64, i64)> = sqlx::query_as(
        "SELECT started_at, accumulated_sec FROM time_records \
          WHERE deleted_at IS NULL ORDER BY started_at",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 2, "跨零点必须拆成两条（昨天 / 今天）");
    let total: i64 = rows.iter().map(|(_, sec)| sec).sum();
    assert_eq!(total, 1_200, "拆分不得改变总时长");
    assert!(
        rows.iter().any(|(started, _)| *started >= today_00),
        "必须有一条属于今天：整段都留在昨天，说明 ended_at 还是 `started_at + target` 算的"
    );
    assert_eq!(count_active(&pool).await, 0);
}
