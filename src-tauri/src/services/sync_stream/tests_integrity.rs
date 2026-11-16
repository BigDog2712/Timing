//! 事件流的**完整性**判据：坏分段不许被跳过、游标不许越过错失的事件。
//!
//! 与 `tests.rs` 分开两个文件，是因为这些判据要手工把远端分段改坏 / 预置成
//! 「已存在但内容不同」/ 在库上注入故障——它们是「同步出错过一次之后还能不能自愈」的
//! 判据，正常往返用例（`tests.rs`）覆盖不到。拆文件同时守单文件 ≤300 行。
//!
//! 覆盖的四类失败（2026-11-16 工程评审 P1-1 / P1-2 / P2-1）：
//!
//! 1. 分段被截断 / 改坏 → 解析失败，游标不前进（`corrupt_segment_is_retried_…`）；
//! 2. 分段内容与本次批次不同 → 不认「已存在」，上传游标不前进（`push_does_not_advance_…`）；
//! 3. 应用中途数据库失败 → **事件与游标一起回滚**，重试能收敛（`failed_apply_leaves_…`）；
//! 4. `sync/events/` 下有不合法的设备目录名 → 记可见错误、其它设备照常（`non_device_dir_…`）。
//!
//! 全部对应 `PLAN-20261114-P4-同步协议.md` §4.4「永不自动丢弃」：
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

/// 原子发布的可见副作用：设备目录里只剩分段本身，不留临时文件。
///
/// 走的是真 IO：`put_if_absent` 先写 `.xxx.tmp` 再发布，任何一步漏了清理都会在这里露出来
/// （残留的临时文件会被用户的同步盘当成分段上传，另一端列目录时又多出一项）。
#[test]
fn published_segment_leaves_no_temp_files() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;
        let root = temp_root("atomic-publish");
        let transport = Transport::Folder(root.clone());
        push_new_events(&pool_a, &transport, A).await.unwrap();

        let dir = root.join("sync").join("events").join(A);
        let mut names: Vec<String> = std::fs::read_dir(&dir)
            .unwrap()
            .map(|entry| entry.unwrap().file_name().to_string_lossy().to_string())
            .collect();
        names.sort();
        assert_eq!(names, vec!["00000001.jsonl".to_string()], "只该有分段本身");

        /* 再推一轮（无新事件）也不许留下东西：这条挡的是「成功路径上忘了删临时文件」。 */
        push_new_events(&pool_a, &transport, A).await.unwrap();
        let count = std::fs::read_dir(&dir).unwrap().count();
        assert_eq!(count, 1, "空轮次不该产生任何文件");
    });
}

/// P1-1：写在「临时文件已完整、还没发布」那一刻失败 → **最终路径上什么都不该有**。
///
/// 这是评审描述的那个故障的等价物（进程/设备在写入过程中退出）。判据是「最终文件不存在」
/// 而不是「文件存在但内容空」—— 后者正是 `fs::write` 直写会留下的形态，也是
/// 「残段被当成完整分段应用、游标推进」的入口。有人把原子发布换回直写，这条立刻红。
#[test]
fn interrupted_write_never_publishes_a_partial_segment() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;
        let root = temp_root("atomic-interrupted");
        let transport = Transport::Folder(root.clone());

        super::transport::fail_before_publish();
        let summary = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(summary.events, 0, "没发布成功 = 这批事件还不算传上去");
        assert!(!summary.errors.is_empty(), "必须报错，下一轮重试");
        assert!(
            !segment_file(&root, A, 1).exists(),
            "最终路径上不许出现半份文件：出现了就会被另一端当成完整分段"
        );
        assert!(
            repository::get(&pool_a, A).await.unwrap().is_none(),
            "上传游标不许推进"
        );

        /* 故障消失后同一轮能正常写出去（说明上面失败的是发布，不是别的东西）。 */
        let retry = push_new_events(&pool_a, &transport, A).await.unwrap();
        assert_eq!(retry.segment_seq, 1, "重试用同一个 seq");
        assert_eq!(retry.events, 4);
        assert!(segment_file(&root, A, 1).exists());
    });
}

/// P1-2：应用中途数据库失败 → 事件与游标**一起回滚**，重试必须能收敛。
///
/// 注入手法是 SQLite 触发器（不改生产代码）：让 `time_records` 的 INSERT 直接 ABORT。
/// 这个时刻正是致命的那个中间态 —— 事件已经 upsert 进 `timer_ops`、物化要写 `time_records`。
///
/// 老代码（每一步各用自己的自动提交）在这里会留下「4 条事件已落库、0 条记录、游标没动」；
/// 重试时 uid 去重让每条事件 `rows_affected = 0`，于是没有任何会话被标 dirty，折叠整段
/// 被跳过、游标推进 —— 这台设备**永远**没有那条记录，且没有任何一轮会去补。
#[test]
fn failed_apply_leaves_no_half_state_and_retry_converges() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        let session = make_session(&pool_a, A).await;

        let root = temp_root("tx-converge");
        let transport = Transport::Folder(root);
        push_new_events(&pool_a, &transport, A).await.unwrap();

        sqlx::query(
            "CREATE TRIGGER tx_fail_record BEFORE INSERT ON time_records
             BEGIN SELECT RAISE(ABORT, 'injected: time_records insert fails'); END",
        )
        .execute(&pool_b)
        .await
        .unwrap();

        let failed = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(failed.applied, 0, "失败的那一段不许有任何事件被算作已应用");
        assert!(!failed.errors.is_empty(), "失败必须说出来（否则用户只看到「同步卡住」）");

        /* 三条断言合起来才是「没有半截状态」：事件、记录、游标必须都停在段前。 */
        let ops: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM timer_ops")
            .fetch_one(&pool_b)
            .await
            .unwrap();
        assert_eq!(ops, 0, "事件 upsert 必须随事务回滚（否则重试会因 uid 去重而跳过折叠）");
        let records: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM time_records")
            .fetch_one(&pool_b)
            .await
            .unwrap();
        assert_eq!(records, 0, "物化也必须回滚");
        assert!(
            repository::get(&pool_b, A).await.unwrap().is_none(),
            "游标不许前进：前进就是这一段永久丢失"
        );

        /* 故障消失后重试：必须原样补上，并与源端逐位一致。 */
        sqlx::query("DROP TRIGGER tx_fail_record")
            .execute(&pool_b)
            .await
            .unwrap();
        let second = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert!(second.errors.is_empty(), "修好之后不该再报错：{:?}", second.errors);
        assert_eq!(second.applied, 4, "重试要把这一段完整补上");
        assert_eq!(
            record_row(&pool_b, &session).await,
            record_row(&pool_a, &session).await,
            "补上之后两端必须逐位一致"
        );
        assert_eq!(
            repository::get(&pool_b, A).await.unwrap().map(|c| c.last_seq),
            Some(1),
            "成功之后游标才前进"
        );
    });
}

/// P2-1：`sync/events/` 下的非法目录名要记可见错误，但**不许拖累**合法设备。
///
/// 名字是 `not-a-device`（不是 12 位小写 hex）。原来这种项会被当成一台对端设备，直接拼
/// 进 URL / 路径；真要在名字里带上 `?` 或 `#`，拼出来的地址与真实目录不是同一份，
/// 那台设备永远读不到，而界面只表现为「同步卡住了」。
#[test]
fn non_device_dir_is_reported_without_blocking_real_peers() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;
        make_session(&pool_a, A).await;

        let root = temp_root("peer-id");
        let transport = Transport::Folder(root.clone());
        push_new_events(&pool_a, &transport, A).await.unwrap();

        /* 混进一个不合法的目录（Windows 上 `?` / `#` 不能出现在文件名里，用长度与大小写违约）。 */
        let stray = root.join("sync").join("events").join("not-a-device");
        std::fs::create_dir_all(&stray).unwrap();
        std::fs::write(stray.join("00000001.jsonl"), b"{}\n").unwrap();

        let summary = pull_segments(&pool_b, &transport, B).await.unwrap();
        assert_eq!(summary.peers, 1, "只有合法的那台算 peer");
        assert_eq!(summary.applied, 4, "合法设备的同步不受影响");
        assert!(
            summary.errors.iter().any(|err| err.contains("not-a-device")),
            "非法目录必须点名报出来，用户才能去清掉它：{:?}",
            summary.errors
        );
    });
}
