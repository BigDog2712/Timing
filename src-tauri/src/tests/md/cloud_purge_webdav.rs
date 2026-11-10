//! 变更 A｜WebDAV 路的判据 + 两条通道互不串账 + 挂点接线（V0.11.19）。
//!
//! 为什么单独一份：`md_cloud_purge.rs` 放的是 LocalFolder 的六道闸行为用例（走真文件
//! 系统、真 pool），这边放 WebDAV 路（假服务器）、分通道的记账、块④ 的读侧投影，以及
//! 「⑩/⑩' 的调用行还在不在」那条接线判据。两份都在 300 行门禁之内，且各自验的是一件
//! 事：**哪一路取证**。

use std::fs;

use chrono::NaiveDate;

use crate::infra::md_webdav::WebdavTarget;
use crate::models::md_cloud_purge::{channel_key, PurgeChannel, PurgeKey};
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::repositories::{md_cloud_pending, settings};
use crate::services::md_cloud::{self, purge};
use crate::services::md_sync::config;
use super::cloud_purge::{kv, list_names, seed_past, state_of};
use super::sync::env;
use crate::tests::support::unique_dir;

#[tokio::test]
async fn webdav_round_never_touches_the_local_mirror() {
    let fixture = env("purge-webdav-mirror").await;
    let root = unique_dir("purge-webdav-mirror");
    fs::create_dir_all(&root).expect("建镜像目录");
    for date in ["2019-07-05", "2019-07-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let before: Vec<String> = list_names(&root);
    let target = WebdavTarget::new("http://127.0.0.1:1", "/Timing", "u", "p");

    purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
        .await
        .expect("远端连不上是「本轮失败」，不是「整轮出错」");

    assert_eq!(list_names(&root), before, "这条路只删远端，镜像留作止损（I5）");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto).await,
        None,
        "一个都没删成功，水位不许推进（I11）"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Day).await,
        None,
        "普通失败不写 day：下一轮接着试"
    );
    let state = state_of(&fixture.pool, PurgeChannel::Webdav).await;
    assert_eq!(state.last_failed, 2, "两个都记账");
    assert_eq!(state.last_deleted, 0);
    assert_eq!(state.fail_days, 1, "失败按自然日记一天");
    assert!(!state.paused, "第一天失败不该暂停（要连续 3 个自然日，I12）");
    let _ = fs::remove_dir_all(&root);
}

/// 六个 KV 键分通道：`webdav` 的水位在前，不会让 `folder` 那一天「已扫过」。

#[tokio::test]
async fn the_two_channels_never_share_accounting() {
    let fixture = env("purge-channels").await;
    let root = unique_dir("purge-channels-target");
    let today = md_cloud::today();
    settings::set_value(&fixture.pool, channel_key(PurgeChannel::Webdav, PurgeKey::Day), &today, 0)
        .await
        .expect("写 day");
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Webdav, PurgeKey::Upto),
        "2099-01-01",
        0,
    )
    .await
    .expect("写水位");

    /* folder 通道的现场必须是空的：共用一份的话，这里会读到 webdav 的「今天已扫」。 */
    assert_eq!(kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Day).await, None);
    assert_eq!(kv(&fixture.pool, PurgeChannel::Folder, PurgeKey::Upto).await, None);

    seed_past(&fixture.pool, &root, "2019-08-05").await;
    purge::run_folder(&fixture.pool, &root, &[], &today)
        .await
        .expect("folder 通道该照常清理");
    assert!(!root.join("2019-08-05.md").exists(), "webdav 的水位不该挡住 folder");
    let _ = fs::remove_dir_all(&root);
}

/// [V0.11.26] 块④/⑤ **各读自己那条通路**：folder 的暂停位不会串到 webdav 那一栏。
///
/// 旧实现只有「当前生效通道」一份 state；拆分后两条通路各有各的 `state` 键，
/// `status(pool, channel)` 必须只看被问的那一条。
#[tokio::test]
async fn status_reports_only_the_active_channel() {
    let fixture = env("purge-status").await;
    let root = unique_dir("purge-status-target");
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Folder, PurgeKey::State),
        r#"{"paused":true,"failDays":3,"lastDeleted":0,"lastFailed":2}"#,
        0,
    )
    .await
    .expect("写 folder 的 state");

    let mut stored = config::load(&fixture.pool).await.expect("读配置");
    stored.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: "https://dav.example.com".into(),
        base_path: "/Timing".into(),
        user: "tester".into(),
        local_root: root.display().to_string(),
        ..Default::default()
    });
    config::save(&fixture.pool, &stored).await.expect("存配置");

    let status = md_cloud::status(&fixture.pool, PurgeChannel::Webdav).await.expect("status");
    assert!(!status.purge.paused, "webdav 那一栏不该读出 folder 的暂停位");
    assert_eq!(status.purge.failed, 0);

    /* 问 folder 那条，同一份 state 就该看见了。 */
    let status = md_cloud::status(&fixture.pool, PurgeChannel::Folder).await.expect("status");
    assert!(status.purge.paused);
    assert_eq!(status.purge.failed, 2);
}

/// 闸⑥ 的**机制**：留底返回 false 时，`save_to` 一个文件都不写、且明确回 false。
///
/// I13e 的端到端夹具（把 `%APP_DIR%\backups\md` 造成一个普通文件）需要动真实数据目录，
/// 由 QA 手验；这里钉住「它认的是布尔结果」这件事本身 —— 变异成「调用过就算成功」时，
/// `purge::folder` 的 `remove_one_without_a_backup_keeps_the_file` 会红。

#[tokio::test]
async fn webdav_purge_deletes_the_date_file_by_its_exact_name() {
    let fixture = env("purge-webdav-ok").await;
    let root = unique_dir("purge-webdav-ok");
    fs::create_dir_all(&root).expect("建镜像目录");
    for date in ["2019-09-05", "2019-09-06"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let fake = super::fake_webdav::serve("204 No Content", "", b"");
    let target = WebdavTarget::new(&fake.base_url, "/Timing", "u", "p");

    purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    assert_eq!(fake.count(), 2, "两份往期各一次 DELETE，不多不少");
    for (index, date) in ["2019-09-05", "2019-09-06"].iter().enumerate() {
        let request = fake.request(index);
        assert!(
            request.starts_with(&format!("DELETE /Timing/{date}.md HTTP/1.1")),
            "目标必须逐字是 `yyyy-MM-dd.md`，实际请求行 {:?}",
            request.lines().next()
        );
        assert!(!request.contains(".."), "路径里不许出现 `..`");
        assert!(
            md_cloud_pending::get(&fixture.pool, PurgeChannel::Webdav, date)
                .await
                .expect("查 pending")
                .is_none(),
            "DELETE 成功后清账（I18）"
        );
    }
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto)
            .await
            .as_deref(),
        Some("2019-09-06"),
        "全部成功 → 水位推到本批最大"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Day)
            .await
            .as_deref(),
        Some(md_cloud::today().as_str()),
        "扫完一整遍 → 写 day"
    );
    assert_eq!(
        state_of(&fixture.pool, PurgeChannel::Webdav).await.last_deleted,
        2
    );
    assert_eq!(list_names(&root).len(), 2, "这条路只删远端（I5）");
    let _ = fs::remove_dir_all(&root);
}

/// I10：401 一出现就整批中断 —— **一份都不再试**（假服务器记下的请求数必须是 1），
/// 水位不动，`day` 照样写。401 在「同一份凭据」下不会因为换一个文件就好。
#[tokio::test]
async fn webdav_401_aborts_the_whole_batch() {
    let fixture = env("purge-webdav-401").await;
    let root = unique_dir("purge-webdav-401");
    fs::create_dir_all(&root).expect("建镜像目录");
    for date in ["2019-10-05", "2019-10-06", "2019-10-07"] {
        seed_past(&fixture.pool, &root, date).await;
    }
    let fake = super::fake_webdav::serve("401 Unauthorized", "", b"");
    let target = WebdavTarget::new(&fake.base_url, "/Timing", "u", "wrong");

    purge::run_webdav(&fixture.pool, &target, &root, &md_cloud::today())
        .await
        .expect("清理不该返回错误");

    assert_eq!(fake.count(), 1, "401 之后一份都不许再发（I10）");
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Upto).await,
        None,
        "中断的那批不推进水位"
    );
    assert_eq!(
        kv(&fixture.pool, PurgeChannel::Webdav, PurgeKey::Day)
            .await
            .as_deref(),
        Some(md_cloud::today().as_str()),
        "提前中断也写 day：今天别再试了"
    );
    let state = state_of(&fixture.pool, PurgeChannel::Webdav).await;
    assert_eq!(state.last_failed, 1, "第一份 401 就中断，只记一份失败");
    assert_eq!(state.fail_days, 1);
    assert_eq!(list_names(&root).len(), 3, "镜像一个文件都不动");
    let _ = fs::remove_dir_all(&root);
}

/// I12：连续第 3 个自然日失败 → 暂停；之后那一轮**一个请求都不发**，直到用户点
/// 「立即同步」（`purge::resume`）。造法：state 写成「昨天已失败 2 天」+ 本轮稳定失败
/// 一次，`failDays` 到 3 就该置 `paused`（不需要假服务器，也就不会 flaky）。
#[tokio::test]
async fn three_failed_days_pause_the_channel() {
    let fixture = env("purge-webdav-pause").await;
    let root = unique_dir("purge-webdav-pause");
    fs::create_dir_all(&root).expect("建镜像目录");
    seed_past(&fixture.pool, &root, "2019-11-05").await;

    let today = md_cloud::today();
    let yesterday = (NaiveDate::parse_from_str(&today, "%Y-%m-%d").expect("今天")
        - chrono::Duration::days(1))
    .format("%Y-%m-%d")
    .to_string();
    settings::set_value(
        &fixture.pool,
        channel_key(PurgeChannel::Webdav, PurgeKey::State),
        &format!(r#"{{"failDays":2,"lastFailDay":"{yesterday}","paused":false}}"#),
        0,
    )
    .await
    .expect("写 state");

    let dead = WebdavTarget::new("http://127.0.0.1:1", "/Timing", "u", "p");
    purge::run_webdav(&fixture.pool, &dead, &root, &today)
        .await
        .expect("失败的一轮不是 Err");

    let state = state_of(&fixture.pool, PurgeChannel::Webdav).await;
    assert_eq!(state.fail_days, 3, "连续第 3 个自然日");
    assert!(state.paused, "到 3 就该暂停（I12）");

    /* 暂停之后这一轮：一个请求都不发（用假服务器计数，比「文件没变」更直接）。 */
    let fake = super::fake_webdav::serve("204 No Content", "", b"");
    let live = WebdavTarget::new(&fake.base_url, "/Timing", "u", "p");
    purge::run_webdav(&fixture.pool, &live, &root, &today)
        .await
        .expect("暂停时直接返回");
    assert_eq!(fake.count(), 0, "暂停后 0 条 DELETE");

    purge::resume(&fixture.pool, PurgeChannel::Webdav)
        .await
        .expect("解除暂停");
    assert!(!state_of(&fixture.pool, PurgeChannel::Webdav).await.paused);
    assert!(list_names(&root).len() == 1);
    let _ = fs::remove_dir_all(&root);
}

/// 接线本身要有一条机器判据（本项目已经栽过两次「写了、接线没接」：`mark_tray_quitting`
/// 的调用点没人看着、`md_section_fence` 的测试没注册）。
///
/// `round_webdav` 的 ⑩ 与 `round_folder` 的 ⑩' 都需要真凭据 + 真落点根，做不出稳定的
/// 端到端夹具；但「挂点被注释掉 / 删掉」这件事完全可以机验，而且**必须**机验 ——
/// 那正是「绿着但什么都没跑」的形状。这里只数**非注释行**里的调用。

#[test]
fn purge_is_wired_into_both_rounds() {
    fn calls(source: &str, needle: &str) -> usize {
        source
            .lines()
            .filter(|line| !line.trim_start().starts_with("//"))
            .filter(|line| line.contains(needle))
            .count()
    }
    let webdav = include_str!("../../services/md_cloud/round_webdav.rs");
    let folder = include_str!("../../services/md_cloud/round_folder.rs");
    assert_eq!(calls(webdav, "purge::run_webdav("), 1, "⑩ 的调用行必须存在且只有一处");
    assert_eq!(calls(folder, "purge::run_folder("), 1, "⑩' 的调用行必须存在且只有一处");
    /* 前置条件也要在：⑩ 只能进「⑧ 成功」那一支，⑩' 只能进 `wrote_ok` 那一支。 */
    assert_eq!(calls(webdav, "if push_ok"), 1, "⑩ 必须挂在 push_ok 之下");
    assert_eq!(calls(folder, "if hash.is_some()"), 1, "⑩' 必须挂在 hash.is_some() 之下");
}
