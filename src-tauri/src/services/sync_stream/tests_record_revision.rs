use super::{apply::apply_and_fold, tests::*, transport::Transport};
use crate::models::record::RecordPatch;
use crate::repositories::{record as records, timer_ops as ops};
use crate::services::{record, timer_ops::TimerOpKind};
use sqlx::SqlitePool;

#[path = "record_revision_edges_tests.rs"]
mod edge_tests;

#[derive(Debug, PartialEq, Eq, sqlx::FromRow)]
struct RecordRow {
    uid: String,
    item_uid: String,
    device_id: String,
    status: String,
    started_at: i64,
    ended_at: Option<i64>,
    accumulated_sec: i64,
    running_since: Option<i64>,
    note: Option<String>,
    mode: String,
    target_sec: Option<i64>,
    deleted_at: Option<i64>,
}

async fn rows(pool: &SqlitePool) -> Vec<RecordRow> {
    sqlx::query_as(
        "SELECT r.uid, i.uid AS item_uid, r.device_id, r.status, r.started_at,
        r.ended_at, r.accumulated_sec, r.running_since, r.note, r.mode, r.target_sec, r.deleted_at
        FROM time_records r JOIN items i ON i.id = r.item_id ORDER BY r.uid",
    )
    .fetch_all(pool)
    .await
    .unwrap()
}

async fn fixture() -> (SqlitePool, SqlitePool, String) {
    let source = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&source).await.unwrap();
    let device = crate::services::device::startup_business_identity(&source)
        .await
        .unwrap();
    let peer = pool_with_item_claimed_to(&device).await;
    (source, peer, device)
}

async fn id(pool: &SqlitePool, uid: &str) -> i64 {
    sqlx::query_scalar("SELECT id FROM time_records WHERE uid = ?")
        .bind(uid)
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn all_ops(pool: &SqlitePool) -> Vec<crate::services::timer_ops::TimerOp> {
    sqlx::query("SELECT id, uid, session_uid, item_uid, kind, at_ms, payload, device_id FROM timer_ops ORDER BY id")
        .fetch_all(pool).await.unwrap().iter().filter_map(ops::to_op).collect()
}

async fn apply(pool: &SqlitePool, events: &[crate::services::timer_ops::TimerOp]) {
    let mut tx = pool.begin().await.unwrap();
    apply_and_fold(&mut tx, events).await.unwrap();
    tx.commit().await.unwrap();
}

#[tokio::test]
async fn saved_record_edits_and_deletes_roundtrip_through_segments() {
    let (source, peer, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    let transport = Transport::Folder(temp_root("record_revision"));
    let peer_id = if device == "bbbbbbbbbbbb" {
        "cccccccccccc"
    } else {
        "bbbbbbbbbbbb"
    };
    super::push_new_events(&source, &transport, &device)
        .await
        .unwrap();
    assert!(super::pull_segments(&peer, &transport, peer_id)
        .await
        .unwrap()
        .errors
        .is_empty());
    let local_id = id(&source, &uid).await;
    record::update(
        &source,
        local_id,
        RecordPatch {
            note: Some("保留暂停累计".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    super::push_new_events(&source, &transport, &device)
        .await
        .unwrap();
    assert!(super::pull_segments(&peer, &transport, peer_id)
        .await
        .unwrap()
        .errors
        .is_empty());
    assert_eq!(rows(&source).await, rows(&peer).await);
    assert_eq!(rows(&peer).await[0].accumulated_sec, 20);
    record::update(
        &source,
        local_id,
        RecordPatch {
            started_at: Some(2_000),
            ended_at: Some(32_000),
            note: Some(String::new()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    super::push_new_events(&source, &transport, &device)
        .await
        .unwrap();
    assert!(super::pull_segments(&peer, &transport, peer_id)
        .await
        .unwrap()
        .errors
        .is_empty());
    assert_eq!(rows(&source).await, rows(&peer).await);
    record::delete(&source, local_id).await.unwrap();
    let count = all_ops(&source).await.len();
    record::delete(&source, local_id).await.unwrap();
    assert_eq!(all_ops(&source).await.len(), count, "重复删除不追加事件");
    super::push_new_events(&source, &transport, &device)
        .await
        .unwrap();
    assert!(super::pull_segments(&peer, &transport, peer_id)
        .await
        .unwrap()
        .errors
        .is_empty());
    assert_eq!(rows(&source).await, rows(&peer).await);
    assert!(rows(&peer).await[0].deleted_at.is_some());
}

#[tokio::test]
async fn saved_record_item_is_resolved_by_uid_not_local_id() {
    let (source, peer, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    let item = crate::services::item::create(&source, "新归属", None)
        .await
        .unwrap();
    let item_uid: String = sqlx::query_scalar("SELECT uid FROM items WHERE id = ?")
        .bind(item.id)
        .fetch_one(&source)
        .await
        .unwrap();
    sqlx::query("INSERT INTO items(id,name,created_at,updated_at,uid,device_id) VALUES(999,'新归属',1,1,?,?)")
        .bind(&item_uid).bind(&device).execute(&peer).await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    record::update(
        &source,
        id(&source, &uid).await,
        RecordPatch {
            item_id: Some(item.id),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    apply(&peer, &all_ops(&source).await).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
    let mapped: i64 = sqlx::query_scalar("SELECT item_id FROM time_records WHERE uid = ?")
        .bind(&uid)
        .fetch_one(&peer)
        .await
        .unwrap();
    assert_eq!(mapped, 999);
}

#[tokio::test]
async fn backfill_and_split_rows_have_portable_identity() {
    let (source, peer, _) = fixture().await;
    let midnight =
        crate::platform::clock::day_bounds(chrono::Local::now().date_naive().pred_opt().unwrap()).0;
    let saved = record::backfill(
        &source,
        1,
        midnight - 60_000,
        midnight + 60_000,
        Some("跨天补记".into()),
    )
    .await
    .unwrap();
    assert_eq!(saved.len(), 2);
    let mut events = all_ops(&source).await;
    events.reverse();
    apply(&peer, &events).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
    apply(&peer, &events).await;
    assert_eq!(rows(&peer).await.len(), 2);
    record::delete(&source, saved[0].id).await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
    assert_eq!(
        rows(&peer)
            .await
            .iter()
            .filter(|row| row.deleted_at.is_none())
            .count(),
        1
    );
}

#[tokio::test]
async fn finalized_midnight_segments_and_undo_match_on_peer() {
    let (source, peer, device) = fixture().await;
    let midnight = crate::platform::clock::day_bounds(chrono::Local::now().date_naive()).0;
    let start = ops::start_session(
        &source,
        1,
        midnight - 60_000,
        "2026-11-17",
        "countup",
        None,
        &device,
    )
    .await
    .unwrap();
    let local_id = id(&source, &start.session_uid).await;
    let active = records::find_by_id(&source, local_id)
        .await
        .unwrap()
        .unwrap();
    let end = midnight + 60_000;
    let mut tx = source.begin().await.unwrap();
    crate::services::timer_split::finalize_in(&mut tx, &active, 90, end, end)
        .await
        .unwrap();
    crate::services::timer_events::record(&mut tx, local_id, TimerOpKind::Stop, end, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
    assert_eq!(
        rows(&peer)
            .await
            .iter()
            .map(|row| row.accumulated_sec)
            .sum::<i64>(),
        90
    );
    let mut tx = source.begin().await.unwrap();
    let resume_at = crate::repositories::record_revision::next_at(&mut tx, local_id, end + 100)
        .await
        .unwrap();
    crate::repositories::record_session::reactivate_in(&mut tx, local_id, resume_at, resume_at)
        .await
        .unwrap();
    crate::services::timer_events::record(&mut tx, local_id, TimerOpKind::Resume, resume_at, None)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
    let reopened = records::find_by_id(&source, local_id)
        .await
        .unwrap()
        .unwrap();
    let mut tx = source.begin().await.unwrap();
    crate::services::timer_split::finalize_in(
        &mut tx,
        &reopened,
        reopened.accumulated_sec + 1,
        resume_at + 1000,
        resume_at + 1000,
    )
    .await
    .unwrap();
    crate::services::timer_events::record(
        &mut tx,
        local_id,
        TimerOpKind::Stop,
        resume_at + 1000,
        None,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    apply(&peer, &all_ops(&source).await).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
}

#[tokio::test]
async fn event_failure_rolls_back_edit_delete_and_backfill() {
    let (source, _, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    let local_id = id(&source, &uid).await;
    let before = rows(&source).await;
    sqlx::query(
        "CREATE TRIGGER reject_revision BEFORE INSERT ON timer_ops WHEN NEW.kind = 'adjust'
        BEGIN SELECT RAISE(ABORT, 'test failure'); END",
    )
    .execute(&source)
    .await
    .unwrap();
    assert!(record::update(
        &source,
        local_id,
        RecordPatch {
            note: Some("不能只改本地".into()),
            ..Default::default()
        }
    )
    .await
    .is_err());
    assert_eq!(rows(&source).await, before);
    assert!(record::delete(&source, local_id).await.is_err());
    assert_eq!(rows(&source).await, before);
    assert!(record::backfill(&source, 1, 50_000, 60_000, None)
        .await
        .is_err());
    assert_eq!(rows(&source).await, before);
}

#[tokio::test]
async fn tombstone_received_first_is_not_resurrected_by_old_events() {
    let (source, peer, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    record::delete(&source, id(&source, &uid).await)
        .await
        .unwrap();
    let events = all_ops(&source).await;
    apply(&peer, &events[events.len() - 1..]).await;
    assert!(rows(&peer).await[0].deleted_at.is_some());
    apply(&peer, &events[..events.len() - 1]).await;
    assert_eq!(rows(&source).await, rows(&peer).await);
}

#[tokio::test]
async fn equal_timestamp_revisions_keep_source_sequence_after_reverse_delivery() {
    let (source, peer, device) = fixture().await;
    let uid = make_session(&source, &device).await;
    let local_id = id(&source, &uid).await;
    record::update(
        &source,
        local_id,
        RecordPatch {
            note: Some("first".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    record::update(
        &source,
        local_id,
        RecordPatch {
            note: Some("second".into()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let mut events = all_ops(&source).await;
    let last = events.len() - 1;
    events[last].at_ms = events[last - 1].at_ms;
    let expected = crate::services::timer_ops::fold_session(&events)
        .block
        .unwrap();
    events.reverse();
    apply(&peer, &events).await;
    let actual = ops::fold(&peer, &uid).await.unwrap().block.unwrap();
    assert_eq!(actual, expected);
    assert_eq!(rows(&peer).await[0].note.as_deref(), Some("second"));
}
