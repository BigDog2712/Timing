//! S3 判据：**状态行与事件流必须一起落**（2026-11-16 评审 P1）。
//!
//! 失效形态（修之前）：`timer_events::record` 把「事件没写进去」降级成一条 `log_warn`。
//! 于是「暂停」在本机成功、在事件流里不存在 —— 对端 fold 出来的是「这台还在跑」。
//! 两条账各自自洽、都不报错，两天后用户看到时长对不上，而日志里只有一条 WARN。
//!
//! 注入手法：给 `timer_ops` 建一个 `BEFORE INSERT ... RAISE(ABORT)` 触发器，让**事件写入
//! 必然失败**，然后断言状态也没落。这个方法的好处是不用改一行生产代码 —— 判据自己
//! 制造故障，而生产路径仍是原来那条。
//!
//! 第三个用例是反向的：不注入时 `pause` 必须真的多出一条事件。少了它，判据会退化成
//! 「只要 pause 报错就通过」—— 那可以用「pause 永远报错」来满足，毫无意义。

use sqlx::SqlitePool;

use crate::repositories::record_session;
use crate::services::timer;
use crate::tests::support::{exec, fresh_pool, scalar_i64};

/// 注入：任何 `timer_ops` 插入都 ABORT。
async fn poison_events(pool: &SqlitePool) {
    exec(
        pool,
        "CREATE TRIGGER s3_fail_event BEFORE INSERT ON timer_ops \
         BEGIN SELECT RAISE(ABORT, 's3 injected failure'); END",
    )
    .await;
}

/// 某个会话的事件条数。
async fn event_count(pool: &SqlitePool, record_id: i64) -> i64 {
    scalar_i64(
        pool,
        &format!(
            "SELECT COUNT(*) FROM timer_ops WHERE session_uid = \
                  (SELECT uid FROM time_records WHERE id = {record_id})"
        ),
    )
    .await
}

#[tokio::test]
async fn s3_01_pause_rolls_back_when_event_cannot_be_written() {
    let pool = fresh_pool("s3-01").await;
    let rec = timer::start(&pool, None).await.expect("开始应成功");
    let running_since = rec.running_since.expect("开始时 running_since 必须有值");
    poison_events(&pool).await;

    assert!(
        timer::pause(&pool).await.is_err(),
        "事件写不进去时，暂停必须失败 —— 静默成功就是两端时长对不上的源头"
    );

    let active = record_session::find_active(&pool)
        .await
        .expect("查询应成功")
        .expect("会话仍应是 active");
    assert_eq!(
        active.running_since,
        Some(running_since),
        "暂停没有落库，running_since 不该被清成 NULL（否则本机显示暂停、对端还在跑）"
    );
}

#[tokio::test]
async fn s3_02_stop_rolls_back_when_event_cannot_be_written() {
    let pool = fresh_pool("s3-02").await;
    let rec = timer::start(&pool, None).await.expect("开始应成功");
    poison_events(&pool).await;

    assert!(
        timer::stop(&pool).await.is_err(),
        "事件写不进去时，结束必须失败"
    );

    let active = record_session::find_active(&pool)
        .await
        .expect("查询应成功")
        .expect("会话必须仍是 active");
    assert_eq!(active.id, rec.id);
    assert_eq!(
        active.status, "active",
        "结束没有落库，一条记录都不该被保存"
    );
}

#[tokio::test]
async fn s3_03_pause_writes_exactly_one_event_on_the_happy_path() {
    /* 反向判据：没有它，上面两条可以用「pause 永远报错」骗过去。 */
    let pool = fresh_pool("s3-03").await;
    let rec = timer::start(&pool, None).await.expect("开始应成功");
    let after_start = event_count(&pool, rec.id).await;
    assert_eq!(after_start, 1, "start 必须落一条事件（跨端同步的起点）");

    timer::pause(&pool).await.expect("正常情况下暂停应成功");
    assert_eq!(
        event_count(&pool, rec.id).await,
        after_start + 1,
        "暂停必须多一条事件，而且只多一条"
    );
}
