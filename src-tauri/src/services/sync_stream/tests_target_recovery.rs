use super::scope::upload;
use super::segment::decode_segment;
use super::tests::{make_session, pool_with_item_claimed_to, temp_root};
use super::tests_target_webdav::WebdavServer;
use super::tests_targets::{bytes, cursor, local_ops, pushed, put_ops, DAY, DEVICE};
use super::{progress, push_new_events, repository, transport::Transport};
use crate::repositories::timer_ops as repo;

#[test]
fn upload_watermark_uses_local_rows_not_larger_source_ids() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        sqlx::query("UPDATE timer_ops SET uid = 'p:' || device_id || ':' || (id + 1000)")
            .execute(&pool)
            .await
            .unwrap();
        let target = Transport::Folder(temp_root("local-watermark-high-source"));
        pushed(&pool, &target, 4, 1).await;
        cursor(&pool, &target, 4, 1).await;
        assert_eq!(
            decode_segment(&bytes(&target, 1).await).unwrap()[3].op_id,
            1004
        );
        let start = repo::start_session(&pool, 1, 50_000, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        let state = progress(&pool, &target.scope().unwrap(), Some(DEVICE), DAY)
            .await
            .unwrap();
        assert_eq!(state.pending_days, vec![DAY.to_string()]);
        assert!(!state.pushed_today);
        pushed(&pool, &target, 1, 2).await;
        assert_eq!(
            decode_segment(&bytes(&target, 2).await).unwrap()[0].uid,
            start.uid
        );
        cursor(&pool, &target, 5, 2).await;
    });
}

#[test]
fn upload_and_recovery_use_local_rows_not_smaller_source_ids() {
    tauri::async_runtime::block_on(async {
        for recover in [false, true] {
            let pool = pool_with_item_claimed_to(DEVICE).await;
            make_session(&pool, DEVICE).await;
            sqlx::query("UPDATE timer_ops SET id = id + 100")
                .execute(&pool)
                .await
                .unwrap();
            let target = Transport::Folder(temp_root(if recover {
                "local-watermark-recover"
            } else {
                "local-watermark-low-source"
            }));
            let ops = local_ops(&pool).await;
            if recover {
                put_ops(&target, 1, &ops[..2]).await;
                pushed(&pool, &target, 2, 2).await;
            } else {
                pushed(&pool, &target, 4, 1).await;
            }
            cursor(&pool, &target, 104, if recover { 2 } else { 1 }).await;
            pushed(&pool, &target, 0, 0).await;
            assert!(
                progress(&pool, &target.scope().unwrap(), Some(DEVICE), DAY)
                    .await
                    .unwrap()
                    .pushed_today
            );
        }
    });
}

#[test]
fn rate_limited_recovery_resumes_after_each_verified_segment() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        let ops = local_ops(&pool).await;
        let server = WebdavServer::new();
        let target = server.transport();
        for seq in 1..=3 {
            put_ops(&target, seq, &ops[seq as usize - 1..seq as usize]).await;
        }
        server.fail_read_at(Some(3));
        let failed = push_new_events(&pool, &target, DEVICE).await.unwrap();
        assert!(!failed.errors.is_empty());
        cursor(&pool, &target, 2, 2).await;
        assert!(
            repository::pending_upload(&pool, &upload(&target.scope().unwrap()), DEVICE)
                .await
                .unwrap()
                .is_none()
        );
        server.fail_read_at(None);
        let before = server.requests().len();
        pushed(&pool, &target, 1, 4).await;
        cursor(&pool, &target, 4, 4).await;
        let requests = server.requests();
        let reads: Vec<_> = requests[before..]
            .iter()
            .filter(|request| request.method == "GET")
            .collect();
        assert!(reads[0].path.ends_with("/00000003.jsonl"));
        assert!(!reads
            .iter()
            .any(|request| request.path.ends_with("/00000001.jsonl")
                || request.path.ends_with("/00000002.jsonl")));
    });
}

#[test]
fn concurrent_pushes_confirm_once_without_leaving_an_old_batch() {
    tauri::async_runtime::block_on(async {
        let pool = pool_with_item_claimed_to(DEVICE).await;
        make_session(&pool, DEVICE).await;
        let target = Transport::Folder(temp_root("concurrent-pushes"));
        let (a, b) = tokio::join!(
            push_new_events(&pool, &target, DEVICE),
            push_new_events(&pool, &target, DEVICE)
        );
        let (a, b) = (a.unwrap(), b.unwrap());
        assert!(a.errors.is_empty() && b.errors.is_empty());
        assert_eq!(a.events + b.events, 4);
        cursor(&pool, &target, 4, 1).await;
        assert!(
            repository::pending_upload(&pool, &upload(&target.scope().unwrap()), DEVICE)
                .await
                .unwrap()
                .is_none()
        );
        assert_eq!(
            decode_segment(&bytes(&target, 1).await).unwrap(),
            local_ops(&pool).await
        );
    });
}
