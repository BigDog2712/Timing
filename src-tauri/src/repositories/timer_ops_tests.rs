//! 事件仓库的判据：折叠结果必须能**原地重建** `time_records`。
//!
//! 这一层唯一真值是「事件流」与「物化状态」逐位相同。做不到时不会有任何报错——
//! 时间轴显示一套、报表显示另一套，而两边都说自己是对的。

use sqlx::SqlitePool;

use crate::repositories::timer_ops;
use crate::services::timer_ops::TimerOpKind;

const DEVICE: &str = "aaaaaaaaaaaa";
const PHONE: &str = "bbbbbbbbbbbb";
const DAY: &str = "2026-11-14";

/// 全新业务库 + 把种子事项「未归类」认领到本机。
///
/// 认领在真实启动里由 `services::device::startup_business_identity` 做；测试不走那条路
/// 是因为它会读真实 `install_id.txt`（同 0009/0010 的用例做法）。
async fn fixture() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&pool).await.unwrap();
    sqlx::query("UPDATE items SET device_id = ?1, uid = 'i:' || ?1 || ':' || id WHERE id = 1")
        .bind(DEVICE)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

async fn row_of(pool: &SqlitePool, session_uid: &str) -> (String, i64, i64, Option<i64>) {
    sqlx::query_as(
        "SELECT status, accumulated_sec, started_at, ended_at FROM time_records WHERE uid = ?1",
    )
    .bind(session_uid)
    .fetch_one(pool)
    .await
    .unwrap()
}

#[test]
fn events_fold_and_materialize_to_the_same_numbers() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let start = timer_ops::start_session(&pool, 1, 1_000, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        assert!(
            start.session_uid.starts_with("t:aaaaaaaaaaaa:"),
            "会话 uid 必须由库的触发器发，前缀与 time_records 一致"
        );

        let session = start.session_uid.clone();
        timer_ops::append(&pool, &session, TimerOpKind::Pause, 11_000, DAY, None, DEVICE)
            .await
            .unwrap();
        timer_ops::append(&pool, &session, TimerOpKind::Resume, 31_000, DAY, None, DEVICE)
            .await
            .unwrap();
        timer_ops::append(&pool, &session, TimerOpKind::Stop, 41_000, DAY, None, DEVICE)
            .await
            .unwrap();

        let folded = timer_ops::fold(&pool, &session).await.unwrap().block.unwrap();
        assert_eq!(folded.accumulated_ms, 20_000, "暂停的 20s 不算进时长");
        assert_eq!(folded.ended_at_ms, Some(41_000));

        timer_ops::materialize(&pool, &folded, 50_000).await.unwrap();
        let (status, accumulated, started, ended) = row_of(&pool, &session).await;
        assert_eq!(status, "saved");
        assert_eq!(accumulated, 20);
        assert_eq!(started, 1_000, "物化后起点必须仍等于 start 事件的语义时刻");
        assert_eq!(ended, Some(41_000));
    });
}

/// 真实运行里暂停不清 `running_since` 之外的任何东西：物化必须把暂停态也写对，
/// 否则「暂停中」重启后会显示成「仍在跑」。
#[test]
fn paused_session_materializes_without_running_since() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let start = timer_ops::start_session(&pool, 1, 0, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        let session = start.session_uid.clone();
        timer_ops::append(&pool, &session, TimerOpKind::Pause, 10_000, DAY, None, DEVICE)
            .await
            .unwrap();

        let folded = timer_ops::fold(&pool, &session).await.unwrap().block.unwrap();
        timer_ops::materialize(&pool, &folded, 20_000).await.unwrap();

        let running: Option<i64> =
            sqlx::query_scalar("SELECT running_since FROM time_records WHERE uid = ?1")
                .bind(&session)
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(running, None, "暂停态必须是 running_since IS NULL");
        let (status, accumulated, _, ended) = row_of(&pool, &session).await;
        assert_eq!(status, "active", "未结束的会话仍是 active");
        assert_eq!(accumulated, 10);
        assert_eq!(ended, None);
    });
}

/// 追加到不存在的会话必须明确失败，不能静默插一条无主事件
/// （那条事件会让 fold 得到 `NoStart`，而故障现象是「手机结束了但 PC 没反应」）。
#[test]
fn appending_to_an_unknown_session_fails_loudly() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let error = timer_ops::append(
            &pool,
            "t:aaaaaaaaaaaa:999",
            TimerOpKind::Stop,
            1,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap_err();
        assert!(error.message.contains("no start event"), "{}", error.message);
    });
}

/// 「手机 9:50 结束、PC 9:59 才收到」：这条 stop 属于手机，插进来后被 PC 的折叠采纳，
/// 而 PC 自己那条 start 一个字节都没被动过。
#[test]
fn remote_stop_wins_over_the_local_later_stop() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        let start = timer_ops::start_session(&pool, 1, 0, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        let session = start.session_uid.clone();

        /* 模拟从对端分片合并进来的 stop（device_id 是手机的，不是本机）。 */
        sqlx::query(
            "INSERT INTO timer_ops(session_uid, item_uid, kind, at_ms, day_key, created_at, device_id)
             VALUES (?1, ?2, 'stop', 50_000, ?3, 50_000, ?4)",
        )
        .bind(&session)
        .bind(&start.item_uid)
        .bind(DAY)
        .bind(PHONE)
        .execute(&pool)
        .await
        .unwrap();
        /* 本机随后自己也结束了一次（用户当时还在本机操作）。 */
        timer_ops::append(&pool, &session, TimerOpKind::Stop, 59_000, DAY, None, DEVICE)
            .await
            .unwrap();

        let folded = timer_ops::fold(&pool, &session).await.unwrap().block.unwrap();
        assert_eq!(
            folded.ended_at_ms,
            Some(50_000),
            "先结束的那条定局，后到的 stop 只是重复信息"
        );
        assert_eq!(folded.accumulated_sec(), 50);
    });
}

/// 事项没有 uid（设备身份没认领成功）时必须报错。
/// 拼一个 `t::12` 出来会把「身份缺失」变成「一行永远对不上号的记录」。
#[test]
fn starting_without_item_uid_is_rejected() {
    tauri::async_runtime::block_on(async {
        let pool = fixture().await;
        sqlx::query(
            "INSERT INTO items(name, status, is_system, sort_order, created_at, updated_at)
             VALUES ('未认领', 'active', 0, 5, 0, 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let unclaimed: i64 = sqlx::query_scalar("SELECT MAX(id) FROM items")
            .fetch_one(&pool)
            .await
            .unwrap();

        let error = timer_ops::start_session(&pool, unclaimed, 0, DAY, "countup", None, DEVICE)
            .await
            .unwrap_err();
        assert!(
            error.message.contains("has no uid"),
            "{}",
            error.message
        );
    });
}
