//! 同库多目标回归：Folder + 回环 WebDAV，库一律 sqlite::memory:。
use super::scope::{download, upload};
use super::segment::{decode_segment, encode_segment};
use super::streams;
use super::tests::{make_session, pool_with_item_claimed_to, record_row, temp_root};
use super::tests_target_webdav::WebdavServer;
use super::{progress, pull_segments, push_new_events, repository, transport::Transport};
use crate::repositories::timer_ops as repo;
use crate::services::timer_ops::{TimerOp, TimerOpKind};
use sqlx::SqlitePool;

pub(super) const DEVICE: &str = "aaaaaaaaaaaa";
pub(super) const PEER: &str = "bbbbbbbbbbbb";
pub(super) const DAY: &str = "2026-11-14";

pub(super) async fn local_ops(pool: &SqlitePool) -> Vec<TimerOp> {
    let rows = sqlx::query(
        "SELECT id, uid, session_uid, item_uid, kind, at_ms, payload, device_id
        FROM timer_ops WHERE device_id = ? AND uid IS NOT NULL ORDER BY id",
    )
    .bind(DEVICE)
    .fetch_all(pool)
    .await
    .unwrap();
    rows.iter()
        .map(|row| repo::to_op(row).expect("fixture 中每条事件都必须可编码"))
        .collect()
}

pub(super) async fn bytes(target: &Transport, seq: u32) -> Vec<u8> {
    target
        .get(&streams::path(DEVICE, &target.scope().unwrap(), seq))
        .await
        .unwrap()
        .expect("分段必须存在")
}

pub(super) async fn put_ops(target: &Transport, seq: u32, ops: &[TimerOp]) -> Vec<u8> {
    let body = encode_segment(ops).into_bytes();
    assert!(target
        .put_if_absent(&streams::path(DEVICE, &target.scope().unwrap(), seq), &body)
        .await
        .unwrap());
    body
}

pub(super) async fn cursor(pool: &SqlitePool, target: &Transport, max_id: i64, seq: i64) {
    let value = repository::get(pool, &upload(&target.scope().unwrap()), DEVICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((value.last_op_id, value.last_seq), (max_id, seq));
}

async fn pull_cursor(pool: &SqlitePool, target: &Transport, max_id: i64, seq: i64) {
    let scope = target.scope().unwrap();
    let value = repository::get(pool, &download(&scope, &scope), DEVICE)
        .await
        .unwrap()
        .unwrap();
    assert_eq!((value.last_op_id, value.last_seq), (max_id, seq));
}

pub(super) async fn pushed(pool: &SqlitePool, target: &Transport, events: usize, seq: u32) {
    let report = push_new_events(pool, target, DEVICE).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!((report.events, report.segment_seq), (events, seq));
}

async fn pending_day(pool: &SqlitePool, target: &Transport, pending: bool) {
    let state = progress(pool, &target.scope().unwrap(), Some(DEVICE), DAY)
        .await
        .unwrap();
    assert_eq!(
        state.pending_days,
        if pending {
            vec![DAY.to_string()]
        } else {
            Vec::<String>::new()
        }
    );
    assert_eq!(state.pushed_today, !pending);
}

async fn both_targets(reverse: bool) {
    let pool = pool_with_item_claimed_to(DEVICE).await;
    let session = make_session(&pool, DEVICE).await;
    let expected = local_ops(&pool).await;
    let server = WebdavServer::new();
    let folder = Transport::Folder(temp_root("target-order"));
    let webdav = server.transport();
    let (first, second) = if reverse {
        (&webdav, &folder)
    } else {
        (&folder, &webdav)
    };
    assert_ne!(first.scope().unwrap(), second.scope().unwrap());
    for target in [first, second] {
        assert!(
            repository::get(&pool, &upload(&target.scope().unwrap()), DEVICE)
                .await
                .unwrap()
                .is_none()
        );
        pending_day(&pool, target, true).await;
    }
    pushed(&pool, first, 4, 1).await;
    pending_day(&pool, first, false).await;
    pending_day(&pool, second, true).await;
    assert!(
        repository::get(&pool, &upload(&second.scope().unwrap()), DEVICE)
            .await
            .unwrap()
            .is_none()
    );
    pushed(&pool, second, 4, 1).await;
    assert_eq!(bytes(first, 1).await, bytes(second, 1).await);
    for target in [first, second] {
        pending_day(&pool, target, false).await;
        cursor(&pool, target, expected[3].op_id, 1).await;
        assert_eq!(decode_segment(&bytes(target, 1).await).unwrap(), expected);
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        let pull = pull_segments(&receiver, target, PEER).await.unwrap();
        assert!(pull.errors.is_empty(), "{:?}", pull.errors);
        assert_eq!((pull.events, pull.applied), (4, 4));
        assert_eq!(
            record_row(&receiver, &session).await,
            record_row(&pool, &session).await
        );
    }
    let requests = server.requests();
    for method in ["PUT", "GET", "PROPFIND"] {
        assert!(
            requests.iter().any(|request| request.method == method),
            "必须走真实 HTTP {method}"
        );
    }
}

#[test]
fn folder_then_webdav_uploads_every_event_with_independent_progress() {
    tauri::async_runtime::block_on(both_targets(false));
}

#[test]
fn webdav_then_folder_uploads_every_event_with_independent_progress() {
    tauri::async_runtime::block_on(both_targets(true));
}

#[test]
fn confirming_b_cannot_clear_a_and_a_retries_identical_bytes_after_new_events() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        let start = repo::start_session(&pool, 1, 1_000, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        let server = WebdavServer::new();
        let a = server.transport();
        let b = Transport::Folder(temp_root("pending-other-target"));
        let (sa, sb) = (upload(&a.scope().unwrap()), upload(&b.scope().unwrap()));
        super::transport::fail_after_put();
        let failed = push_new_events(&pool, &a, DEVICE).await.unwrap();
        assert_eq!((failed.events, failed.segment_seq), (0, 0));
        assert!(repository::get(&pool, &sa, DEVICE).await.unwrap().is_none());
        let batch = repository::pending_upload(&pool, &sa, DEVICE)
            .await
            .unwrap()
            .unwrap();
        assert_eq!(bytes(&a, 1).await, batch.body);
        pending_day(&pool, &a, true).await;
        pushed(&pool, &b, 1, 1).await;
        assert_eq!(
            repository::pending_upload(&pool, &sa, DEVICE)
                .await
                .unwrap(),
            Some(batch.clone())
        );
        assert!(repository::pending_upload(&pool, &sb, DEVICE)
            .await
            .unwrap()
            .is_none());
        repo::append(
            &pool,
            &start.session_uid,
            TimerOpKind::Stop,
            2_000,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap();
        assert_eq!(
            repository::pending_upload(&pool, &sa, DEVICE)
                .await
                .unwrap(),
            Some(batch.clone())
        );
        let before_retry = server.requests().len();
        pushed(&pool, &a, 1, 1).await;
        assert_eq!(bytes(&a, 1).await, batch.body, "不许将新 stop 合并到旧 seq");
        let requests = server.requests();
        let puts: Vec<_> = requests[before_retry..]
            .iter()
            .filter(|request| request.method == "PUT" && request.path.ends_with("/00000001.jsonl"))
            .collect();
        assert_eq!(
            puts.len(),
            1,
            "必须真正重发 PUT，不能把首次 409 后补建重试算作本次重试"
        );
        assert_eq!(puts[0].body, batch.body, "重试 PUT 必须逐字相同");
        assert!(repository::pending_upload(&pool, &sa, DEVICE)
            .await
            .unwrap()
            .is_none());
        cursor(&pool, &a, batch.max_op_id, 1).await;
        cursor(&pool, &b, batch.max_op_id, 1).await;
        pushed(&pool, &a, 1, 2).await;
        let ops = local_ops(&pool).await;
        assert_eq!(decode_segment(&bytes(&a, 2).await).unwrap(), ops[1..]);
        pending_day(&pool, &a, false).await;
        pending_day(&pool, &b, true).await;
    });
}

#[test]
fn same_peer_with_different_segment_boundaries_does_not_lose_stop() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        let session = make_session(&source, DEVICE).await;
        let ops = local_ops(&source).await;
        let server = WebdavServer::new();
        let a = Transport::Folder(temp_root("peer-boundaries"));
        let b = server.transport();
        put_ops(&a, 1, &ops[..1]).await;
        put_ops(&a, 2, &ops[1..3]).await;
        put_ops(&b, 1, &ops).await; // stop 在 B 的 seq1，比 A 已读 seq2 还小。
        let first = pull_segments(&receiver, &a, PEER).await.unwrap();
        assert!(first.errors.is_empty(), "{:?}", first.errors);
        assert_eq!((first.segments, first.events, first.applied), (2, 3, 3));
        pull_cursor(&receiver, &a, ops[2].op_id, 2).await;
        assert_eq!(record_row(&receiver, &session).await.2, None);
        assert!(repository::get(
            &receiver,
            &download(&b.scope().unwrap(), &b.scope().unwrap()),
            DEVICE
        )
        .await
        .unwrap()
        .is_none());
        let second = pull_segments(&receiver, &b, PEER).await.unwrap();
        assert!(second.errors.is_empty(), "{:?}", second.errors);
        assert_eq!((second.segments, second.events, second.applied), (1, 4, 1));
        pull_cursor(&receiver, &b, ops[3].op_id, 1).await;
        pull_cursor(&receiver, &a, ops[2].op_id, 2).await;
        assert_eq!(
            record_row(&receiver, &session).await,
            record_row(&source, &session).await
        );
        put_ops(&a, 3, &ops[3..]).await;
        let duplicate = pull_segments(&receiver, &a, PEER).await.unwrap();
        assert!(duplicate.errors.is_empty(), "{:?}", duplicate.errors);
        assert_eq!((duplicate.events, duplicate.applied), (1, 0));
        for target in [&a, &b] {
            let repeat = pull_segments(&receiver, target, PEER).await.unwrap();
            assert!(repeat.errors.is_empty(), "{:?}", repeat.errors);
            assert_eq!((repeat.events, repeat.applied), (0, 0));
        }
        let counts: (i64, i64) =
            sqlx::query_as("SELECT COUNT(*), COUNT(DISTINCT uid) FROM timer_ops")
                .fetch_one(&receiver)
                .await
                .unwrap();
        assert_eq!(counts, (4, 4), "同 UID 不许重复落库");
        let records: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_records")
            .fetch_one(&receiver)
            .await
            .unwrap();
        assert_eq!(records, 1);
        assert_eq!(
            record_row(&receiver, &session).await,
            record_row(&source, &session).await
        );
    });
}

#[test]
fn switching_a_b_a_keeps_each_targets_own_sequence() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        let server = WebdavServer::new();
        let a = Transport::Folder(temp_root("switch-back"));
        let b = server.transport();
        let start = repo::start_session(&pool, 1, 1_000, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        pushed(&pool, &a, 1, 1).await;
        let first = bytes(&a, 1).await;
        repo::append(
            &pool,
            &start.session_uid,
            TimerOpKind::Pause,
            11_000,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap();
        pushed(&pool, &a, 1, 2).await;
        repo::append(
            &pool,
            &start.session_uid,
            TimerOpKind::Resume,
            31_000,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap();
        pushed(&pool, &b, 3, 1).await;
        repo::append(
            &pool,
            &start.session_uid,
            TimerOpKind::Stop,
            41_000,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap();
        pushed(&pool, &a, 2, 3).await;
        let ops = local_ops(&pool).await;
        cursor(&pool, &a, ops[3].op_id, 3).await;
        cursor(&pool, &b, ops[2].op_id, 1).await;
        pending_day(&pool, &a, false).await;
        pending_day(&pool, &b, true).await;
        assert_eq!(bytes(&a, 1).await, first);
        pushed(&pool, &b, 1, 2).await;
        for (target, last) in [(&a, 3), (&b, 2)] {
            let mut uploaded = Vec::new();
            for seq in 1..=last {
                uploaded.extend(decode_segment(&bytes(target, seq).await).unwrap());
            }
            assert_eq!(uploaded, ops);
            pushed(&pool, target, 0, 0).await;
            cursor(&pool, target, ops[3].op_id, i64::from(last)).await;
        }
    });
}

#[test]
fn empty_or_failed_first_push_never_creates_a_scoped_cursor() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        let server = WebdavServer::new();
        let webdav = server.transport();
        let folder = Transport::Folder(temp_root("first-failure"));
        for target in [&folder, &webdav] {
            pushed(&pool, target, 0, 0).await;
            assert!(
                repository::get(&pool, &upload(&target.scope().unwrap()), DEVICE)
                    .await
                    .unwrap()
                    .is_none()
            );
            assert!(target
                .get(&streams::path(DEVICE, &target.scope().unwrap(), 1))
                .await
                .unwrap()
                .is_none());
        }
        make_session(&pool, DEVICE).await;
        server.fail_reads(true);
        let failed = push_new_events(&pool, &webdav, DEVICE).await.unwrap();
        assert!(!failed.errors.is_empty());
        assert_eq!((failed.events, failed.segment_seq), (0, 0));
        assert!(
            repository::get(&pool, &upload(&webdav.scope().unwrap()), DEVICE)
                .await
                .unwrap()
                .is_none()
        );
        assert!(!server
            .requests()
            .iter()
            .any(|request| request.method == "PUT"));
        super::transport::fail_before_publish();
        let failed = push_new_events(&pool, &folder, DEVICE).await.unwrap();
        assert!(!failed.errors.is_empty());
        assert!(
            repository::get(&pool, &upload(&folder.scope().unwrap()), DEVICE)
                .await
                .unwrap()
                .is_none()
        );
        assert!(folder
            .get(&streams::path(DEVICE, &folder.scope().unwrap(), 1))
            .await
            .unwrap()
            .is_none());
        server.fail_reads(false);
        pushed(&pool, &webdav, 4, 1).await;
        pushed(&pool, &folder, 4, 1).await;
    });
}
