use sqlx::SqlitePool;
use std::collections::BTreeMap;
use std::path::Path;

use super::tests::{pool_with_item_claimed_to, record_row, temp_root};
use super::tests_target_webdav::WebdavServer;
use super::tests_targets::{local_ops, DAY, DEVICE, PEER};
use super::{pull_segments, push_new_events, repository, scope, streams, transport::Transport};
use crate::repositories::timer_ops as repo;
use crate::services::timer_ops::TimerOpKind;

fn folder_files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    fn visit(root: &Path, dir: &Path, files: &mut BTreeMap<String, Vec<u8>>) {
        for entry in std::fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                visit(root, &path, files);
            } else {
                files.insert(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_str()
                        .unwrap()
                        .replace('\\', "/"),
                    std::fs::read(path).unwrap(),
                );
            }
        }
    }
    let mut files = BTreeMap::new();
    visit(root, root, &mut files);
    files
}

fn copy_to_folder(root: &Path, files: &BTreeMap<String, Vec<u8>>) {
    for (rel, body) in files {
        let path = root.join(rel);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, body).unwrap();
    }
}

async fn send(pool: &SqlitePool, target: &Transport, events: usize, seq: u32) {
    let report = push_new_events(pool, target, DEVICE).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!((report.events, report.segment_seq), (events, seq));
}

async fn receive(pool: &SqlitePool, target: &Transport, applied: usize) {
    let report = pull_segments(pool, target, PEER).await.unwrap();
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(report.applied, applied);
}

async fn delayed_copy(reverse: bool) {
    let source = pool_with_item_claimed_to(DEVICE).await;
    let receiver = pool_with_item_claimed_to(DEVICE).await;
    let server = WebdavServer::new();
    let root = temp_root(if reverse {
        "shared-dav-first"
    } else {
        "shared-folder-first"
    });
    let folder = Transport::Folder(root.clone());
    let webdav = server.transport();
    let (first, second) = if reverse {
        (&webdav, &folder)
    } else {
        (&folder, &webdav)
    };
    let start = repo::start_session(&source, 1, 1_000, DAY, "countup", None, DEVICE)
        .await
        .unwrap();
    send(&source, first, 1, 1).await;
    repo::append(
        &source,
        &start.session_uid,
        TimerOpKind::Pause,
        11_000,
        DAY,
        None,
        DEVICE,
    )
    .await
    .unwrap();
    send(&source, first, 1, 2).await;
    receive(&receiver, first, 2).await;
    repo::append(
        &source,
        &start.session_uid,
        TimerOpKind::Resume,
        31_000,
        DAY,
        None,
        DEVICE,
    )
    .await
    .unwrap();
    repo::append(
        &source,
        &start.session_uid,
        TimerOpKind::Stop,
        41_000,
        DAY,
        None,
        DEVICE,
    )
    .await
    .unwrap();
    send(&source, second, 4, 1).await;
    let a = streams::path(DEVICE, &first.scope().unwrap(), 1);
    let b = streams::path(DEVICE, &second.scope().unwrap(), 1);
    assert_ne!(a, b, "独立批次不许同名");
    assert_ne!(first.get(&a).await.unwrap(), second.get(&b).await.unwrap());
    let original_folder = folder_files(&root);
    let original_dav = server.files();
    for (rel, body) in &original_folder {
        server.external_copy(rel, body);
    }
    copy_to_folder(&root, &original_dav);
    receive(&receiver, first, 2).await;
    let first_scope = first.scope().unwrap();
    for (writer, seq) in [(first.scope().unwrap(), 2), (second.scope().unwrap(), 1)] {
        let ledger = scope::download(&first_scope, &writer);
        assert_eq!(
            repository::get(&receiver, &ledger, DEVICE)
                .await
                .unwrap()
                .unwrap()
                .last_seq,
            seq
        );
    }
    let expected = ("saved".to_string(), 1_000, Some(41_000), 20);
    assert_eq!(record_row(&receiver, &start.session_uid).await, expected);
    send(&source, first, 2, 3).await;
    let all_folder = folder_files(&root);
    let all_dav = server.files();
    for (rel, body) in &all_folder {
        server.external_copy(rel, body);
    }
    copy_to_folder(&root, &all_dav);
    // 再迟到的旧快照可以覆盖同名文件，但每条流的已发布字节必须完全相同。
    for (rel, body) in &original_folder {
        server.external_copy(rel, body);
    }
    copy_to_folder(&root, &original_dav);
    for (rel, body) in original_folder.iter().chain(original_dav.iter()) {
        assert_eq!(std::fs::read(root.join(rel)).unwrap(), *body);
        assert_eq!(server.files().get(rel), Some(body));
    }
    for target in [&folder, &webdav] {
        receive(&receiver, target, 0).await;
        let fresh = pool_with_item_claimed_to(DEVICE).await;
        receive(&fresh, target, 4).await;
        assert_eq!(record_row(&fresh, &start.session_uid).await, expected);
        assert_eq!(local_ops(&fresh).await.len(), 4);
        let own = pull_segments(&source, target, DEVICE).await.unwrap();
        assert!(own.errors.is_empty());
        assert_eq!((own.peers, own.events, own.applied), (0, 0, 0));
        assert_eq!(record_row(&receiver, &start.session_uid).await, expected);
    }
    assert_eq!(local_ops(&receiver).await.len(), 4);
    assert!(!root.join("sync/events").exists());
    assert!(!server
        .files()
        .keys()
        .any(|key| key.starts_with("sync/events/")));
    assert!(server
        .requests()
        .iter()
        .any(|request| request.method == "PROPFIND"));
}

#[test]
fn delayed_folder_copy_cannot_overwrite_webdav_stop() {
    tauri::async_runtime::block_on(delayed_copy(false));
}

#[test]
fn delayed_webdav_copy_cannot_overwrite_folder_stop() {
    tauri::async_runtime::block_on(delayed_copy(true));
}

#[test]
fn missing_sequence_waits_and_late_copy_completes_the_stream() {
    tauri::async_runtime::block_on(async {
        let source = pool_with_item_claimed_to(DEVICE).await;
        let receiver = pool_with_item_claimed_to(DEVICE).await;
        let folder = Transport::Folder(temp_root("shared-hole-source"));
        let server = WebdavServer::new();
        let webdav = server.transport();
        let start = repo::start_session(&source, 1, 1_000, DAY, "countup", None, DEVICE)
            .await
            .unwrap();
        send(&source, &folder, 1, 1).await;
        repo::append(
            &source,
            &start.session_uid,
            TimerOpKind::Stop,
            41_000,
            DAY,
            None,
            DEVICE,
        )
        .await
        .unwrap();
        send(&source, &folder, 1, 2).await;
        let writer = folder.scope().unwrap();
        let one = streams::path(DEVICE, &writer, 1);
        let two = streams::path(DEVICE, &writer, 2);
        server.external_copy(&two, &folder.get(&two).await.unwrap().unwrap());
        receive(&receiver, &webdav, 0).await;
        let ledger = scope::download(&webdav.scope().unwrap(), &writer);
        assert!(repository::get(&receiver, &ledger, DEVICE)
            .await
            .unwrap()
            .is_none());
        server.external_copy(&one, &folder.get(&one).await.unwrap().unwrap());
        receive(&receiver, &webdav, 2).await;
        assert_eq!(record_row(&receiver, &start.session_uid).await.3, 40);
        assert_eq!(
            repository::get(&receiver, &ledger, DEVICE)
                .await
                .unwrap()
                .unwrap()
                .last_seq,
            2
        );
        receive(&receiver, &webdav, 0).await;
    });
}
