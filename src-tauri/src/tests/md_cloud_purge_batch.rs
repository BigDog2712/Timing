//! 变更 A｜LocalFolder 的两条**收敛**判据：批上限（I15）与连续失败暂停（I12）。
//!
//! 这两条都不验「删得对不对」，验的是「删不完 / 删不动时怎么收场」：单轮 20 份、扫完
//! 才写 `day`（否则首轮大扫要拖 10 天）；连续 3 个自然日失败就停手，等用户点一次
//! 「立即同步」。两件事都只在真 pool + 真目录上看得出来，所以和 `md_cloud_purge.rs`
//! 分开放（那边是六道闸的主路径）。

use std::fs;

use chrono::NaiveDate;

use crate::models::constants::MD_CLOUD_PURGE_BATCH;
use crate::models::md_cloud_purge::{channel_key, PurgeChannel, PurgeKey, PurgeState};
use crate::repositories::settings;
use crate::services::md_cloud::{self, purge};
use crate::tests::md_cloud_purge::{kv, list_names, seed_past, state_of};
use crate::tests::md_sync::env;
use crate::tests::support::unique_dir;

#[tokio::test]
async fn folder_round_converges_at_the_batch_limit() {
    let fixture = env("purge-folder-batch").await;
    let root = unique_dir("purge-folder-batch-target");
    let total = MD_CLOUD_PURGE_BATCH + 3;
    let mut dates = Vec::new();
    for index in 0..total {
        let date = NaiveDate::from_ymd_opt(2019, 5, 1)
            .expect("日期")
            .checked_add_days(chrono::Days::new(index as u64))
            .expect("日期")
            .format("%Y-%m-%d")
            .to_string();
        seed_past(&fixture.pool, &root, &date).await;
        dates.push(date);
    }
    let today = md_cloud::today();

    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("第一轮");
    assert_eq!(
        list_names(&root).len(),
        total - MD_CLOUD_PURGE_BATCH,
        "单轮只做 {MD_CLOUD_PURGE_BATCH} 个"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day).await,
        None,
        "整遍还没扫完，不许写 day —— 否则首轮大扫要拖 10 天"
    );

    /* 同一天再跑一轮：`day` 没写，所以会接着删剩下的。 */
    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("第二轮");
    assert!(list_names(&root).is_empty(), "23 份往期在两轮里删完（目录里没有当天那份）");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day)
            .await
            .as_deref(),
        Some(today.as_str()),
        "扫完了才写 day"
    );
    let _ = fs::remove_dir_all(&root);
}

/// I12：暂停之后 0 条删除；「立即同步」的 `resume` 只清当前通道，之后恢复尝试。

#[tokio::test]
async fn paused_channel_is_skipped_until_resume() {
    let fixture = env("purge-folder-paused").await;
    let root = unique_dir("purge-folder-paused-target");
    for date in ["2019-06-05", "2019-06-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let mut paused = PurgeState {
        paused: true,
        fail_days: 3,
        ..Default::default()
    };
    /* 另一条通道的现场：不该被 folder 的 resume 动到（分通道的硬约束）。 */
    let mut other = PurgeState {
        paused: true,
        fail_days: 2,
        ..Default::default()
    };
    for (channel, state) in [
        (PurgeChannel::Folder, &mut paused),
        (PurgeChannel::Webdav, &mut other),
    ] {
        settings::set_value(
            &fixture.pool,
            channel_key(channel, PurgeKey::State),
            &serde_json::to_string(state).expect("序列化"),
            0,
        )
        .await
        .expect("写 state");
    }

    purge::run_folder(&fixture.pool, &root, &[], &md_cloud::today())
        .await
        .expect("暂停时直接返回");
    assert_eq!(list_names(&root).len(), 2, "暂停后 0 条 DELETE");

    purge::resume(&fixture.pool, PurgeChannel::Folder)
        .await
        .expect("解除暂停");
    let folder = state_of(&fixture.pool, PurgeChannel::Folder).await;
    assert!(!folder.paused && folder.fail_days == 0, "只清当前通道");
    assert!(
        state_of(&fixture.pool, PurgeChannel::Webdav).await.paused,
        "另一条通道的暂停位必须原样保留"
    );

    purge::run_folder(&fixture.pool, &root, &[], &md_cloud::today())
        .await
        .expect("解除后恢复清理");
    assert!(list_names(&root).is_empty(), "恢复后两份往期都被删（这个目录里没有当天那份）");
    let _ = fs::remove_dir_all(&root);
}
