//! 事件流的**完整性**判据：坏分段不许被跳过、游标不许越过错失的事件。
//!
//! 与 `tests.rs` 分开两个文件，是因为这两条判据要手工把远端分段改坏 / 预置成
//! 「已存在但内容不同」——它们是「同步出错过一次之后还能不能自愈」的判据，
//! 正常往返用例（`tests.rs`）覆盖不到。拆文件同时守单文件 ≤300 行。
//!
//! 两条用例都对应 `PLAN-20261114-P4-同步协议.md` §4.4「永不自动丢弃」：
//! 失败可以重试，**不能**静默往后走。

use super::pull_segments;
use super::push_new_events;
use super::repository;
use super::tests::{make_session, pool_with_item_claimed_to, record_row, temp_root};
use super::transport::Transport;

const A: &str = "aaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbb";

/// 分段在本地目录通路下的绝对路径。
fn segment_file(root: &std::path::Path, device: &str, seq: u32) -> std::path::PathBuf {
    root.join("sync")
        .join("events")
        .join(device)
        .join(format!("{seq:08}.jsonl"))
}

#[test]
fn corrupt_segment_is_retried_instead_of_being_skipped() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        let session = make_session(&pool_a, A).await;

        let root = temp_root("corrupt-retry");
        let transport = Transport::Folder(root.clone());
        push_new_events(&pool_a, &transport, A).await.unwrap();

        /* 把分段改成半截（模拟写到一半被读、或网盘截断）：解析必然失败。 */
        let file = segment_file(&root, A, 1);
        let good = std::fs::read(&file).unwrap();
        std::fs::write(&file, &good[..good.len() / 2]).unwrap();

        let first = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(first.applied, 0, "坏分段里的任何事件都不许被应用");
        assert!(
            !first.errors.is_empty(),
            "坏分段必须报错（否则用户完全看不到同步卡住了）"
        );
        let cursor = repository::get(&pool_b, A).await.unwrap();
        assert_eq!(
            cursor.map(|c| c.last_seq).unwrap_or(0),
            0,
            "游标绝不能越过坏分段：越过 = 这一段永久丢失"
        );

        /* 分段修复（重传成功）之后，下一轮必须能把这一段补上。 */
        std::fs::write(&file, &good).unwrap();
        let second = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(second.applied, 4, "修好之后要原样补上，不能永久跳过");
        assert_eq!(
            record_row(&pool_b, &session).await,
            record_row(&pool_a, &session).await,
            "补上之后两端必须逐位一致"
        );
    });
}

#[test]
fn push_does_not_advance_cursor_when_existing_segment_differs() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;

        let root = temp_root("push-content-check");
        let transport = Transport::Folder(root.clone());

        /* 模拟「上一轮 PUT 成功了、游标没落库，且这一轮批次更长」：
           同一个 seq 上已经躺着一份**不同内容**的分段。 */
        let file = segment_file(&root, A, 1);
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{\"uid\":\"p:aaaaaaaaaaaa:1\"}\n").unwrap();

        let first = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(first.events, 0, "内容不同 = 没确认写入，不许当成已上传");
        assert!(!first.errors.is_empty(), "必须报错，下一轮重试");
        assert!(
            repository::get(&pool_a, A).await.unwrap().is_none(),
            "游标不许推进：推进就是中间那批事件永久不对端可见"
        );

        /* 清掉坏分段，下一轮照常补传。 */
        std::fs::remove_file(&file).unwrap();
        let second = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(second.events, 4);
        assert_eq!(second.segment_seq, 1, "重试用的是同一个 seq，不跳号");
        let cursor = repository::get(&pool_a, A).await.unwrap().expect("游标必须落库");
        assert_eq!(cursor.last_seq, 1);
        assert!(cursor.last_op_id > 0, "上传游标要记到已传的最大 op_id");
    });
}

#[test]
fn repushing_an_identical_segment_is_treated_as_success() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;

        let root = temp_root("push-identical");
        let transport = Transport::Folder(root);
        let first = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(first.segment_seq, 1);

        /* 把游标退回去，模拟「PUT 成功、游标没落库」。 */
        repository::upsert(&pool_a, A, 0, 0).await.unwrap();

        let second = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert!(second.errors.is_empty(), "内容逐字节相同 ⇒ 就是已上传：{:?}", second.errors);
        assert_eq!(second.segment_seq, 1);
        assert_eq!(repository::get(&pool_a, A).await.unwrap().unwrap().last_seq, 1);
    });
}
