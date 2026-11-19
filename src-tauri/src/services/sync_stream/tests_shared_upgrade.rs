use super::segment::{encode_segment, segment_path};
use super::tests::{make_session, pool_with_item_claimed_to, record_row, temp_root};
use super::tests_target_webdav::WebdavServer;
use super::tests_targets::{local_ops, DAY, DEVICE, PEER};
use super::{
    progress, pull_segments, push_new_events, repository, scope, streams, transport::Transport,
};

#[test]
fn legacy_target_ledgers_and_pending_bytes_are_preserved_but_never_reused() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let session = make_session(&source, DEVICE).await;
        let ops = local_ops(&source).await;
        let server = WebdavServer::new();
        let folder = Transport::Folder(temp_root("shared-upgrade"));
        let webdav = server.transport();
        for (target, old_body) in [
            (&folder, encode_segment(&ops[..1])),
            (&webdav, encode_segment(&ops)),
        ] {
            let raw = target.scope().unwrap();
            repository::upsert(&source, &raw, DEVICE, 999_999, 81)
                .await
                .unwrap();
            let old_batch = repository::stage_upload(
                &source,
                &raw,
                DEVICE,
                82,
                1_000_000,
                b"legacy\0opaque\xff",
            )
            .await
            .unwrap();
            let old_cursor = repository::get(&source, &raw, DEVICE).await.unwrap();
            assert!(target
                .put_if_absent(&segment_path(DEVICE, 1), old_body.as_bytes())
                .await
                .unwrap());
            assert!(
                !progress(&source, &raw, Some(DEVICE), DAY)
                    .await
                    .unwrap()
                    .pushed_today
            );
            let push = push_new_events(&source, target, DEVICE).await.unwrap();
            assert!(push.errors.is_empty(), "{:?}", push.errors);
            assert_eq!((push.events, push.segment_seq), (4, 1));
            assert_eq!(
                target
                    .get(&streams::path(DEVICE, &raw, 1))
                    .await
                    .unwrap()
                    .unwrap(),
                encode_segment(&ops).as_bytes()
            );
            assert_eq!(
                target.get(&segment_path(DEVICE, 1)).await.unwrap().unwrap(),
                old_body.as_bytes()
            );
            assert!(target
                .get(&segment_path(DEVICE, 82))
                .await
                .unwrap()
                .is_none());
            assert!(
                progress(&source, &raw, Some(DEVICE), DAY)
                    .await
                    .unwrap()
                    .pushed_today
            );
            crate::infra::migrate::migrate(&source).await.unwrap();
            assert_eq!(
                repository::get(&source, &raw, DEVICE).await.unwrap(),
                old_cursor
            );
            assert_eq!(
                repository::pending_upload(&source, &raw, DEVICE)
                    .await
                    .unwrap(),
                Some(old_batch)
            );
            let receiver = pool_with_item_claimed_to(DEVICE).await;
            repository::upsert(&receiver, &raw, DEVICE, 999_999, 81)
                .await
                .unwrap();
            let pull = pull_segments(&receiver, target, PEER).await.unwrap();
            assert!(pull.errors.is_empty(), "{:?}", pull.errors);
            assert_eq!(pull.applied, 4, "旧接收游标不能吞掉新流低序号事件");
            assert_eq!(
                record_row(&receiver, &session).await,
                record_row(&source, &session).await
            );
            assert_eq!(
                repository::get(&receiver, &raw, DEVICE)
                    .await
                    .unwrap()
                    .unwrap()
                    .last_seq,
                81
            );
            assert_eq!(
                repository::get(&receiver, &scope::download(&raw, &raw), DEVICE)
                    .await
                    .unwrap()
                    .unwrap()
                    .last_seq,
                1
            );
        }
        assert!(!server
            .requests()
            .iter()
            .any(|request| request.method == "PUT" && request.path.ends_with("/00000082.jsonl")));
    });
}

#[test]
fn legacy_files_are_still_readable_and_new_replay_does_not_duplicate_events() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        let session = make_session(&source, DEVICE).await;
        let ops = local_ops(&source).await;
        let folder = Transport::Folder(temp_root("shared-legacy-reader"));
        for (seq, slice) in [(1, &ops[..2]), (2, &ops[2..])] {
            assert!(folder
                .put_if_absent(&segment_path(DEVICE, seq), encode_segment(slice).as_bytes())
                .await
                .unwrap());
        }
        let legacy = pull_segments(&receiver, &folder, PEER).await.unwrap();
        assert!(legacy.errors.is_empty());
        assert_eq!((legacy.events, legacy.applied), (4, 4));
        let raw = folder.scope().unwrap();
        assert_eq!(
            repository::get(&receiver, &raw, DEVICE)
                .await
                .unwrap()
                .unwrap()
                .last_seq,
            2
        );
        let push = push_new_events(&source, &folder, DEVICE).await.unwrap();
        assert!(push.errors.is_empty());
        assert_eq!((push.events, push.segment_seq), (4, 1));
        let replay = pull_segments(&receiver, &folder, PEER).await.unwrap();
        assert!(replay.errors.is_empty());
        assert_eq!((replay.peers, replay.events, replay.applied), (1, 4, 0));
        assert_eq!(local_ops(&receiver).await, ops);
        assert_eq!(
            record_row(&receiver, &session).await,
            record_row(&source, &session).await
        );
        assert_eq!(
            repository::get(&receiver, &scope::download(&raw, &raw), DEVICE)
                .await
                .unwrap()
                .unwrap()
                .last_seq,
            1
        );
    });
}

#[test]
fn corrupt_legacy_segment_does_not_block_valid_new_stream() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        let session = make_session(&source, DEVICE).await;
        let server = WebdavServer::new();
        let target = server.transport();
        server.external_copy(&segment_path(DEVICE, 1), b"broken legacy");
        let push = push_new_events(&source, &target, DEVICE).await.unwrap();
        assert!(push.errors.is_empty());
        let report = pull_segments(&receiver, &target, PEER).await.unwrap();
        assert!(
            !report.errors.is_empty(),
            "旧损坏依旧可见，不能伪报整轮成功"
        );
        assert_eq!(report.applied, 4);
        assert_eq!(
            record_row(&receiver, &session).await,
            record_row(&source, &session).await
        );
        assert!(repository::get(&receiver, &target.scope().unwrap(), DEVICE)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            target.get(&segment_path(DEVICE, 1)).await.unwrap().unwrap(),
            b"broken legacy"
        );
    });
}

#[test]
fn malformed_stream_names_are_skipped_without_fetching_their_contents() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        make_session(&source, DEVICE).await;
        let server = WebdavServer::new();
        let target = server.transport();
        server.external_copy(
            &format!("sync/streams/{DEVICE}/not-a-writer/00000001.jsonl"),
            b"invalid",
        );
        push_new_events(&source, &target, DEVICE).await.unwrap();
        let before = server.requests().len();
        let report = pull_segments(&receiver, &target, PEER).await.unwrap();
        assert!(report.errors.is_empty(), "{:?}", report.errors);
        assert_eq!(report.applied, 4);
        assert!(report
            .warnings
            .iter()
            .any(|text| text.contains("not-a-writer")));
        assert!(!server.requests()[before..]
            .iter()
            .any(|request| request.path.contains("not-a-writer")));
    });
}
