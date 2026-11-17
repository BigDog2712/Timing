//! schema15 升级、旧远端前缀恢复、scope 身份合同；不接触真实用户库。
use sqlx::SqlitePool;
use super::{progress, push_new_events, repository, transport::Transport};
use super::segment::{decode_segment, encode_segment, segment_path};
use super::tests::{make_session, pool_with_item_claimed_to, temp_root};
use super::tests_targets::{bytes, cursor, local_ops, put_ops, pushed, DAY, DEVICE, PEER};
use super::tests_target_webdav::WebdavServer;
use crate::infra::{md_webdav::WebdavTarget, migrate::migrate};

type Legacy = (Vec<(String, i64, i64)>, Vec<(String, i64, i64, Vec<u8>)>);

async fn legacy_snapshot(pool: &SqlitePool) -> Legacy {
    let cursors = sqlx::query_as("SELECT device_id, last_op_id, last_seq FROM sync_event_cursor ORDER BY device_id")
        .fetch_all(pool).await.unwrap();
    let batches = sqlx::query_as("SELECT device_id, seq, max_op_id, body FROM sync_event_outbox ORDER BY device_id")
        .fetch_all(pool).await.unwrap();
    (cursors, batches)
}

async fn seed_legacy(pool: &SqlitePool) -> Legacy {
    for (device, seq) in [(DEVICE, 80i64), (PEER, 90)] {
        sqlx::query("INSERT INTO sync_event_cursor(device_id,last_op_id,last_seq) VALUES (?,999999,?)")
            .bind(device).bind(seq).execute(pool).await.unwrap();
        sqlx::query("INSERT INTO sync_event_outbox(device_id,seq,max_op_id,body) VALUES (?,?,1000000,?)")
            .bind(device).bind(seq + 1).bind(b"legacy\0opaque\xff".as_slice()).execute(pool).await.unwrap();
    }
    legacy_snapshot(pool).await
}

#[test]
fn high_legacy_cursor_and_outbox_are_not_inherited_by_either_target() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        let legacy = seed_legacy(&pool).await;
        let server = WebdavServer::new();
        let a = Transport::Folder(temp_root("legacy-not-inherited"));
        let b = server.transport();
        let expected = local_ops(&pool).await;
        for target in [&a, &b] {
            let scope = target.scope().unwrap();
            assert!(repository::get(&pool, &scope, DEVICE).await.unwrap().is_none());
            assert!(repository::pending_upload(&pool, &scope, DEVICE).await.unwrap().is_none());
            let state = progress(&pool, &scope, Some(DEVICE), DAY).await.unwrap();
            assert_eq!(state.pending_days, vec![DAY.to_string()]);
            assert!(!state.pushed_today);
            pushed(&pool, target, 4, 1).await;
            assert_eq!(decode_segment(&bytes(target, 1).await).unwrap(), expected);
            cursor(&pool, target, expected[3].op_id, 1).await;
            assert_eq!(legacy_snapshot(&pool).await, legacy, "旧表必须逐字段原样保留");
        }
    });
}

#[test]
fn migration_15_to_16_preserves_legacy_and_composite_keys_across_rerun() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        // 仅在这个内存库拆掉全量 migrate 刚建的空表，模拟真实 v15。
        for table in ["sync_target_cursor", "sync_target_outbox"] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool).await.unwrap();
            assert_eq!(count, 0);
            sqlx::query(&format!("DROP TABLE {table}")).execute(&pool).await.unwrap();
        }
        sqlx::query("UPDATE settings SET value='15' WHERE key='schema.version'").execute(&pool).await.unwrap();
        let legacy = seed_legacy(&pool).await;
        migrate(&pool).await.unwrap();
        let version: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='schema.version'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, "16");
        assert_eq!(legacy_snapshot(&pool).await, legacy);
        for table in ["sync_target_cursor", "sync_target_outbox"] {
            let count: i64 = sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table}"))
                .fetch_one(&pool).await.unwrap();
            assert_eq!(count, 0, "迁移不能把 legacy 猜配给任何 scope");
            let keys: Vec<String> = sqlx::query_scalar("SELECT name FROM pragma_table_info(?) WHERE pk > 0 ORDER BY pk")
                .bind(table).fetch_all(&pool).await.unwrap();
            assert_eq!(keys, vec!["scope", "device_id"]);
        }
        let a = Transport::Folder(temp_root("migration-a")).scope().unwrap();
        let b = Transport::Folder(temp_root("migration-b")).scope().unwrap();
        let ba = repository::stage_upload(&pool, &a, DEVICE, 1, 10, b"a\0batch").await.unwrap();
        let bb = repository::stage_upload(&pool, &b, DEVICE, 1, 20, b"b\0batch").await.unwrap();
        let bp = repository::stage_upload(&pool, &a, PEER, 2, 30, b"peer").await.unwrap();
        let retry = repository::stage_upload(&pool, &a, DEVICE, 9, 99, b"must-not-replace").await.unwrap();
        assert_eq!(retry, ba);
        for (scope, device, id, seq) in [(&a, DEVICE, 0, 0), (&b, DEVICE, 5, 0), (&a, PEER, 7, 1)] {
            repository::upsert(&pool, scope, device, id, seq).await.unwrap();
        }
        repository::confirm_upload(&pool, &a, DEVICE, &ba).await.unwrap();
        migrate(&pool).await.unwrap(); // 第二次升级调用也不能重建/清空任一张表。
        assert_eq!(legacy_snapshot(&pool).await, legacy);
        assert!(repository::pending_upload(&pool, &a, DEVICE).await.unwrap().is_none());
        assert_eq!(repository::pending_upload(&pool, &b, DEVICE).await.unwrap(), Some(bb));
        assert_eq!(repository::pending_upload(&pool, &a, PEER).await.unwrap(), Some(bp));
        for (scope, device, id, seq) in [(&a, DEVICE, 10, 1), (&b, DEVICE, 5, 0), (&a, PEER, 7, 1)] {
            let value = repository::get(&pool, scope, device).await.unwrap().unwrap();
            assert_eq!((value.last_op_id, value.last_seq), (id, seq));
        }
        let version: String = sqlx::query_scalar("SELECT value FROM settings WHERE key='schema.version'")
            .fetch_one(&pool).await.unwrap();
        assert_eq!(version, "16");
    });
}

#[test]
fn matching_multiple_old_segments_resume_at_the_next_sequence() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        let ops = local_ops(&pool).await;
        let server = WebdavServer::new();
        let target = server.transport();
        let first = put_ops(&target, 1, &ops[..1]).await;
        let second = put_ops(&target, 2, &ops[1..3]).await;
        let before = server.requests().len();
        assert!(repository::get(&pool, &target.scope().unwrap(), DEVICE).await.unwrap().is_none());
        pushed(&pool, &target, 1, 3).await;
        cursor(&pool, &target, ops[3].op_id, 3).await;
        assert_eq!(bytes(&target, 1).await, first);
        assert_eq!(bytes(&target, 2).await, second);
        assert_eq!(decode_segment(&bytes(&target, 3).await).unwrap(), ops[3..]);
        let requests = server.requests();
        let uploads: Vec<_> = requests[before..].iter().filter(|request| request.method == "PUT").collect();
        assert_eq!(uploads.len(), 1, "恢复不得尝试重写 seq1/seq2");
        assert!(uploads[0].path.ends_with("/00000003.jsonl"));
        pushed(&pool, &target, 0, 0).await;
        assert!(target.get(&segment_path(DEVICE, 4)).await.unwrap().is_none());
    });
}

#[test]
fn fully_uploaded_old_prefix_restores_cursor_without_writing_a_new_segment() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        let ops = local_ops(&pool).await;
        let target = Transport::Folder(temp_root("fully-recovered"));
        let first = put_ops(&target, 1, &ops[..2]).await;
        let second = put_ops(&target, 2, &ops[2..]).await;
        pushed(&pool, &target, 0, 0).await;
        cursor(&pool, &target, ops[3].op_id, 2).await;
        assert_eq!(bytes(&target, 1).await, first);
        assert_eq!(bytes(&target, 2).await, second);
        assert!(target.get(&segment_path(DEVICE, 3)).await.unwrap().is_none());
        assert!(progress(&pool, &target.scope().unwrap(), Some(DEVICE), DAY).await.unwrap().pushed_today);
    });
}

async fn rejects_old_prefix(case: &str) {
    let pool = pool_with_item_claimed_to(DEVICE).await;
    make_session(&pool, DEVICE).await;
    let ops = local_ops(&pool).await;
    let target = Transport::Folder(temp_root(case));
    let first = put_ops(&target, 1, &ops[..1]).await;
    let mut bad_ops = vec![ops[1].clone()];
    match case {
        "content-conflict" => bad_ops[0].at_ms += 7, // UID 不变、完整性正确，内容却不是本机事件。
        "skipped-event" => bad_ops = vec![ops[2].clone()],
        "reordered-events" => bad_ops = vec![ops[2].clone(), ops[1].clone()],
        "duplicate-event" => bad_ops = vec![ops[0].clone()],
        "truncated-prefix" => {},
        _ => panic!("unknown fixture"),
    }
    let mut bad = encode_segment(&bad_ops).into_bytes();
    if case == "truncated-prefix" {
        bad.truncate(bad.iter().position(|byte| *byte == b'\n').unwrap() + 1);
        assert!(decode_segment(&bad).is_err(), "有效 JSONL 行但缺少尾标");
    } else {
        assert_eq!(decode_segment(&bad).unwrap(), bad_ops, "确实是完整段，不靠解码失败蒙混过关");
    }
    assert!(target.put_if_absent(&segment_path(DEVICE, 2), &bad).await.unwrap());
    for _ in 0..2 {
        let report = push_new_events(&pool, &target, DEVICE).await.unwrap();
        assert!(!report.errors.is_empty(), "坏远端必须可见：{case}");
        assert_eq!((report.events, report.segment_seq), (0, 0));
        cursor(&pool, &target, ops[0].op_id, 1).await;
        assert_eq!(bytes(&target, 1).await, first);
        assert_eq!(bytes(&target, 2).await, bad, "既有字节绝不能覆盖");
        assert!(target.get(&segment_path(DEVICE, 3)).await.unwrap().is_none());
        assert_eq!(local_ops(&pool).await, ops);
    }
}

#[test]
fn complete_segment_with_same_uid_but_different_content_blocks_recovery() {
    tauri::async_runtime::block_on(rejects_old_prefix("content-conflict"));
}

#[test]
fn truncated_old_segment_stops_at_the_last_verified_cursor() {
    tauri::async_runtime::block_on(rejects_old_prefix("truncated-prefix"));
}

#[test]
fn complete_but_missing_reordered_or_duplicated_events_are_not_a_prefix() {
    tauri::async_runtime::block_on(async {
        for case in ["skipped-event", "reordered-events", "duplicate-event"] { rejects_old_prefix(case).await; }
    });
}

fn assert_digest(scope: &str) {
    assert!(scope.len() >= 64, "scope 必须包含 SHA256 指纹而非明文地址");
    assert!(scope.as_bytes()[scope.len() - 64..].iter().all(u8::is_ascii_hexdigit));
}

#[test]
fn folder_scope_is_stable_for_absolute_canonical_aliases_and_distinct_paths() {
    let root = temp_root("scope-folder");
    std::fs::create_dir_all(root.join("child")).unwrap();
    let target = Transport::Folder(root.clone());
    let scope = target.scope().unwrap();
    assert_digest(&scope);
    for alias in [root.canonicalize().unwrap(), root.join("."), root.join("child").join("..")] {
        assert_eq!(Transport::Folder(alias).scope().unwrap(), scope);
    }
    assert_eq!(target.scope().unwrap(), scope);
    assert_ne!(Transport::Folder(root.join("child")).scope().unwrap(), scope);
}

#[test]
fn webdav_scope_excludes_password_but_distinguishes_account_path_and_url() {
    let original = WebdavTarget::new("https://dav.example.invalid/root", "/Timing", "alice", "old-secret");
    let scope = Transport::Webdav(original.clone()).scope().unwrap();
    assert_digest(&scope);
    let mut rotated = original.clone();
    rotated.password = "new-secret".to_string();
    assert_eq!(Transport::Webdav(rotated).scope().unwrap(), scope);
    assert!(!scope.contains("old-secret"));
    assert_eq!(Transport::Webdav(original.clone()).scope().unwrap(), scope);
    for target in [
        WebdavTarget::new(&original.base_url, "/Timing", "bob", "old-secret"),
        WebdavTarget::new(&original.base_url, "/Other", "alice", "old-secret"),
        WebdavTarget::new("https://other.example.invalid/root", "/Timing", "alice", "old-secret"),
    ] { assert_ne!(Transport::Webdav(target).scope().unwrap(), scope); }
}

#[test]
fn webdav_scope_normalization_matches_url_for_including_repeated_slashes() {
    let inputs = [
        ("https://dav.example.invalid/dav", "/Timing/events"),
        (" https://dav.example.invalid/dav/// ", "//Timing/events//"),
        ("https://dav.example.invalid/dav/Timing", "/events"),
        ("https://dav.example.invalid/dav", "\\Timing\\events\\"),
        ("https://dav.example.invalid/dav", "/Timing//events"),
        ("https://dav.example.invalid//dav", "/Timing/events"),
    ];
    let targets: Vec<_> = inputs.iter().map(|(url, path)| WebdavTarget::new(url, path, "alice", "secret")).collect();
    assert_eq!(targets[0].url_for("").unwrap(), targets[1].url_for("").unwrap());
    assert_ne!(targets[0].url_for("").unwrap(), targets[4].url_for("").unwrap());
    for left in &targets {
        for right in &targets {
            assert_eq!(Transport::Webdav(left.clone()).scope().unwrap() == Transport::Webdav(right.clone()).scope().unwrap(),
                left.url_for("").unwrap() == right.url_for("").unwrap(),
                "不能额外折叠 url_for 保留的中间双斜杠，也不能按原始配置字符串区分同一实际 URL");
        }
    }
}
