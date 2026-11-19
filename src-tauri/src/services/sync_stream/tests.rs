//! 事件流的判据：push 的传输量 ∝ 新增事件数、两端 fold 一致、重复同步不重复 fold。
//!
//! 用 [`Transport::Folder`]（临时目录）走真 IO，业务库用 `sqlite::memory:`——不碰网络，
//! 但把「写分段 → 读分段 → 去重折叠」这条链完整跑通。

use std::path::PathBuf;

use sqlx::SqlitePool;

use super::{pull_segments, push_new_events, transport::Transport};
use crate::repositories::timer_ops as repo;
use crate::services::timer_ops::TimerOpKind;

const A: &str = "aaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbb";
const DAY: &str = "2026-11-14";

/// 全新业务库 + 把种子事项「未归类」认领到指定设备（模拟两端各自已持有对方的事项）。
pub(super) async fn pool_with_item_claimed_to(device: &str) -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&pool).await.unwrap();
    sqlx::query("UPDATE items SET device_id = ?1, uid = 'i:' || ?1 || ':' || id WHERE id = 1")
        .bind(device)
        .execute(&pool)
        .await
        .unwrap();
    pool
}

/// 每个用例一个独立临时目录，避免并行用例互相读到对方的分段。
pub(super) fn temp_root(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "sync-stream-{tag}-{}-{}",
        std::process::id(),
        std::thread::current()
            .name()
            .unwrap_or("t")
            .replace(':', "_")
    ));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

pub(super) type Row = (String, i64, Option<i64>, i64);

pub(super) async fn record_row(pool: &SqlitePool, session_uid: &str) -> Row {
    sqlx::query_as(
        "SELECT status, started_at, ended_at, accumulated_sec FROM time_records WHERE uid = ?1",
    )
    .bind(session_uid)
    .fetch_one(pool)
    .await
    .unwrap()
}

/// 在设备 A 上造一段「开始→暂停→继续→结束」，返回会话 uid。
pub(super) async fn make_session(pool: &SqlitePool, device: &str) -> String {
    let start = repo::start_session(pool, 1, 1_000, DAY, "countup", None, device)
        .await
        .unwrap();
    let session = start.session_uid.clone();
    repo::append(
        pool,
        &session,
        TimerOpKind::Pause,
        11_000,
        DAY,
        None,
        device,
    )
    .await
    .unwrap();
    repo::append(
        pool,
        &session,
        TimerOpKind::Resume,
        31_000,
        DAY,
        None,
        device,
    )
    .await
    .unwrap();
    repo::append(pool, &session, TimerOpKind::Stop, 41_000, DAY, None, device)
        .await
        .unwrap();
    /* 本机把折叠结果物化回去，给「两端 fold 一致」留一个本机基线。 */
    let folded = repo::fold(pool, &session).await.unwrap().block.unwrap();
    repo::materialize(pool, &folded, 41_000).await.unwrap();
    session
}

#[test]
fn push_then_pull_folds_to_the_same_record_on_both_sides() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        let session = make_session(&pool_a, A).await;

        let root = temp_root("roundtrip");
        let transport = Transport::Folder(root);

        let push = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(push.events, 4, "4 条事件都要进分段");
        assert_eq!(push.segment_seq, 1);

        let pull = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(pull.peers, 1, "只发现 A 一台对端");
        assert_eq!(pull.events, 4);
        assert_eq!(pull.applied, 4, "首轮全部是新事件");

        let row_a = record_row(&pool_a, &session).await;
        let row_b = record_row(&pool_b, &session).await;
        assert_eq!(row_a, row_b, "两端折叠出的 time_records 必须逐位一致");
        assert_eq!(row_b, ("saved".to_string(), 1_000, Some(41_000), 20));
    });
}

#[test]
fn repeated_pull_is_idempotent() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;

        let root = temp_root("idempotent");
        let transport = Transport::Folder(root);
        push_new_events(&pool_a, &transport, A).await.unwrap();

        let first = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(first.applied, 4);

        let second = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(second.events, 0, "游标推进后不再读旧分段");
        assert_eq!(second.applied, 0, "重复同步不产生重复 fold");

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_records")
            .fetch_one(&pool_b)
            .await
            .unwrap();
        assert_eq!(count, 1, "time_records 不因重复拉取翻倍");
    });
}

#[test]
fn push_only_transfers_new_events() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;

        let root = temp_root("incremental");
        let transport = Transport::Folder(root);

        let first = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(first.events, 4);
        assert_eq!(first.segment_seq, 1);

        /* 库又变大：新开一个会话（2 条事件）。下一轮只传这 2 条，与库大小无关。 */
        let start = repo::start_session(&pool_a, 1, 50_000, DAY, "countup", None, A)
            .await
            .unwrap();
        repo::append(
            &pool_a,
            &start.session_uid,
            TimerOpKind::Stop,
            51_000,
            DAY,
            None,
            A,
        )
        .await
        .unwrap();

        let second = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(second.events, 2, "第二轮只传新增事件");
        assert_eq!(second.segment_seq, 2, "分段序号单调递增");
    });
}

#[test]
fn dropped_session_is_soft_deleted_on_the_peer() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        let start = repo::start_session(&pool_a, 1, 1_000, DAY, "countup", None, A)
            .await
            .unwrap();
        let session = start.session_uid.clone();

        let root = temp_root("drop");
        let transport = Transport::Folder(root);

        /* 先让 B 拿到「进行中」的会话。 */
        push_new_events(&pool_a, &transport, A).await.unwrap();
        pull_segments(&pool_b, &transport, B).await.unwrap();
        let active: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM time_records WHERE uid = ?1")
                .bind(&session)
                .fetch_one(&pool_b)
                .await
                .unwrap();
        assert!(active.is_none(), "同步后先是一段进行中/未删除的会话");

        /* A 丢弃该会话（drop 是一条事件，不是删旧事件）。 */
        repo::append(&pool_a, &session, TimerOpKind::Drop, 5_000, DAY, None, A)
            .await
            .unwrap();
        push_new_events(&pool_a, &transport, A).await.unwrap();
        pull_segments(&pool_b, &transport, B).await.unwrap();

        let deleted: Option<i64> =
            sqlx::query_scalar("SELECT deleted_at FROM time_records WHERE uid = ?1")
                .bind(&session)
                .fetch_one(&pool_b)
                .await
                .unwrap();
        assert!(deleted.is_some(), "drop 事件必须在另一端软删该会话");
    });
}

#[test]
fn close_old_and_open_new_in_the_same_segment_does_not_collide() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;

        let root = temp_root("close_open");
        let transport = Transport::Folder(root);

        /* A 开 session1 并推给 B，B 得到一条 active。 */
        let s1 = repo::start_session(&pool_a, 1, 1_000, DAY, "countup", None, A)
            .await
            .unwrap();
        let s1_uid = s1.session_uid.clone();
        push_new_events(&pool_a, &transport, A).await.unwrap();
        pull_segments(&pool_b, &transport, B).await.unwrap();

        /* A 结束 session1（物化回 saved）、又开 session2：两条事件落在同一分段。 */
        repo::append(&pool_a, &s1_uid, TimerOpKind::Stop, 2_000, DAY, None, A)
            .await
            .unwrap();
        let folded1 = repo::fold(&pool_a, &s1_uid).await.unwrap().block.unwrap();
        repo::materialize(&pool_a, &folded1, 2_000).await.unwrap();
        let s2 = repo::start_session(&pool_a, 1, 2_000, DAY, "countup", None, A)
            .await
            .unwrap();
        let s2_uid = s2.session_uid.clone();

        push_new_events(&pool_a, &transport, A).await.unwrap();
        let pull = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert!(
            pull.errors.is_empty(),
            "同段「收旧开新」不得报错：{:?}",
            pull.errors
        );

        let s1_status: String =
            sqlx::query_scalar("SELECT status FROM time_records WHERE uid = ?1")
                .bind(&s1_uid)
                .fetch_one(&pool_b)
                .await
                .unwrap();
        assert_eq!(s1_status, "saved", "旧会话要收口");
        let s2_status: String =
            sqlx::query_scalar("SELECT status FROM time_records WHERE uid = ?1")
                .bind(&s2_uid)
                .fetch_one(&pool_b)
                .await
                .unwrap();
        assert_eq!(s2_status, "active", "新会话要进入计时中");
    });
}

#[test]
fn staged_batch_survives_success_before_cursor_commit() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(A).await;
        let start = repo::start_session(&pool, 1, 1_000, DAY, "countup", None, A)
            .await
            .unwrap();
        let root = temp_root("crash_after_put");
        let transport = Transport::Folder(root);
        let source_scope = transport.scope().unwrap();
        let upload_scope = super::scope::upload(&source_scope);
        super::transport::fail_after_put();
        let failed = push_new_events(&pool, &transport, A).await.unwrap();
        assert_eq!(failed.segment_seq, 0, "注入崩溃时游标不能提交");
        let first = super::repository::pending_upload(&pool, &upload_scope, A)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(
            transport
                .get(&super::streams::path(A, &source_scope, first.seq as u32))
                .await
                .unwrap()
                .unwrap(),
            first.body
        );
        repo::append(
            &pool,
            &start.session_uid,
            TimerOpKind::Stop,
            2_000,
            DAY,
            None,
            A,
        )
        .await
        .unwrap();

        let retry = super::repository::pending_upload(&pool, &upload_scope, A)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(retry, first, "重试必须使用持久化的 seq、边界和完全相同字节");
        let push = super::push_new_events(&pool, &transport, A).await.unwrap();
        assert_eq!(push.segment_seq, 1);
        assert_eq!(push.events, 1);
        assert!(super::repository::pending_upload(&pool, &upload_scope, A)
            .await
            .unwrap()
            .is_none());
        let next = super::push_new_events(&pool, &transport, A).await.unwrap();
        assert_eq!(next.segment_seq, 2, "确认后新增事件使用下一个 seq");
    });
}

#[test]
fn empty_push_and_pull_are_noops() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(A).await;
        let root = temp_root("noop");
        let transport = Transport::Folder(root);
        let push = push_new_events(&pool, &transport, A).await.unwrap();
        assert_eq!(push.events, 0);
        let pull = pull_segments(&pool, &transport, A).await.unwrap();
        assert_eq!(pull.peers, 0);
        assert_eq!(pull.applied, 0);
    });
}
