//! 事件流的**孤儿 active 会话**判据：对端被强杀（断电 / dev 重建 / 任务管理器结束）之后，
//! 「start 了但没 stop」的会话会有**不止一条**，折叠必须能走过去，而不是撞
//! `uq_records_open_per_device`（每设备一条 active）把整段回滚掉。
//!
//! 这类失败与 `tests_integrity.rs` 那四类不同：那些是「分段坏了」，这个是**分段完全合规**
//! ——尾标对得上、事件一条不缺、哈希一致——只是数据里有两段没收口的会话。后果也不一样：
//! 游标停在原地、每轮重试同一个死法、**没有任何一轮会修它**，用户只看到「同步一直不成功」
//! （手机侧连提示都没有，只有 logcat）。0.12.10 真机实测：桌面 7 个分段、15 个会话里有
//! 6 条孤儿，手机端游标永久停在 seq=0。
//!
//! 单独一个文件，既守住单文件 ≤300 行的门禁，也把「脏历史」和「坏分段」两类判据分开。

use super::pull_segments;
use super::push_new_events;
use super::tests::{pool_with_item_claimed_to, record_row, temp_root};
use super::transport::Transport;
use crate::repositories::timer_ops as repo;

const A: &str = "aaaaaaaaaaaa";
const B: &str = "bbbbbbbbbbbb";
const DAY: &str = "2026-11-14";

/// 一台设备上两条孤儿会话（1s 和 51s 各开一次，都没结束）。
///
/// 造法要点：`repo::start_session` 自己会往 `time_records` 插 active 行，所以第二条会被
/// 本地唯一索引挡住 —— 而我们要的正是「本地没有两条 active、但**事件流**里有两段没收口」。
/// 删掉物化行正好等于崩溃后 `startup self-heal` 的效果：会话被封口了，但 stop 事件从没发出去。
#[test]
fn two_orphan_open_sessions_on_one_device_still_fold() {
    tauri::async_runtime::block_on(async {
        let pool_a = pool_with_item_claimed_to(A).await;
        let pool_b = pool_with_item_claimed_to(A).await;

        let first = repo::start_session(&pool_a, 1, 1_000, DAY, "countup", None, A)
            .await
            .unwrap()
            .session_uid;
        /* 崩溃现场：self-heal 把这条封在本地，但没有 stop 事件进事件流。 */
        sqlx::query("DELETE FROM time_records")
            .execute(&pool_a)
            .await
            .unwrap();
        let second = repo::start_session(&pool_a, 1, 51_000, DAY, "countup", None, A)
            .await
            .unwrap()
            .session_uid;
        assert_ne!(first, second, "两次 start 必须是两个会话");

        let root = temp_root("orphan-open");
        let transport = Transport::Folder(root);
        push_new_events(&pool_a, &transport, A).await.unwrap();

        /* 修复前：这里 Err(UNIQUE constraint failed: time_records.device_id)，整段回滚。 */
        pull_segments(&pool_b, &transport, B).await.unwrap();

        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM time_records WHERE status = 'active' AND device_id = ?1",
        )
        .bind(A)
        .fetch_one(&pool_b)
        .await
        .unwrap();
        assert_eq!(active, 1, "每设备只允许一条 active，多出来的必须被补收尾");

        assert_eq!(
            record_row(&pool_b, &first).await,
            ("saved".to_string(), 1_000, Some(51_000), 50),
            "先到的那条收尾在后一条开始的时刻（1s → 51s = 50 秒）"
        );
        assert_eq!(
            record_row(&pool_b, &second).await,
            ("active".to_string(), 51_000, None, 0),
            "后到的那条保持 active，时长不被前一条污染"
        );
    });
}
