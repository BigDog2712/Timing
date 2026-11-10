//! [V0.11.26] 双通路的两条隔离判据（PRD R1 / R2，设计 §一 难点 3、§八 7）。
//!
//! 这次改造的核心风险不是「功能没做」，而是「两条通路串了账」：
//!
//! 1. **账本串**：`md_cloud_pending` 的主键从 `(date)` 变成 `(date, channel)`。串了的话
//!    「folder 今天写过了」会让 webdav 以为「今天传过了」，一整天的远端副本静默缺一版；
//! 2. **轮次串**：`round()` 依次跑 folder 再跑 webdav。第一半失败若把整轮 `?` 掉，
//!    webdav 那一半就再也不会执行——用户只能看到「本地同步失败」，云端欠账却一天天堆。
//!
//! 两条都用**行为**断言（不读实现里的分支标志），因此「回退成共享一份账本」或
//! 「本地轮失败提前 return」的变异都会当场变红。

use std::fs;

use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::repositories::md_cloud_pending as repo;
use crate::services::md_cloud;
use crate::services::md_sync::config;
use super::sync::env;
use crate::platform::clock::now_ms;
use crate::tests::support::{fresh_pool, insert_saved, new_item, unique_dir};

/// 账本隔离：同一天、两条通路各一行，谁清谁都不许动对面。
#[tokio::test]
async fn pending_rows_never_cross_the_two_channels() {
    let pool = fresh_pool("dual-pending").await;
    let date = "2026-11-05";

    repo::mark_pending(&pool, PurgeChannel::Webdav, date, "hash-webdav", 1_000)
        .await
        .expect("记 webdav 欠账");

    /* 另一半必须完全没被惊动：共享一份账本时这里会读到 webdav 那一行。 */
    assert!(
        repo::get(&pool, PurgeChannel::Folder, date)
            .await
            .expect("查 folder")
            .is_none(),
        "folder 账本里不该有 webdav 记的行"
    );
    assert!(
        repo::pending_dates(&pool, PurgeChannel::Folder)
            .await
            .expect("查 folder 清单")
            .is_empty(),
        "folder 的待传清单不该被 webdav 的行填上"
    );

    /* 同一天两条通路各记一行：主键是 (date, channel)，两行必须能共存。 */
    repo::mark_pending(&pool, PurgeChannel::Folder, date, "hash-folder", 2_000)
        .await
        .expect("记 folder 欠账");
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM md_cloud_pending")
        .fetch_one(&pool)
        .await
        .expect("数行数");
    assert_eq!(rows, 2, "同一天两条通路各一行，主键必须是 (date, channel)");

    /* 清一条不动另一条。 */
    repo::clear(&pool, PurgeChannel::Folder, date)
        .await
        .expect("清 folder");
    assert!(
        repo::get(&pool, PurgeChannel::Webdav, date)
            .await
            .expect("查 webdav")
            .is_some(),
        "清 folder 的账不许把 webdav 的欠账一起清掉（那是远端那一份的凭证）"
    );
}

/// 轮次隔离：folder 那一半建不出目录（失败），webdav 那一半仍必须照跑。
///
/// 判据只看 `report.errors` 里**两条通路的错同时在场**——只验「round 没 Err」不够：
/// 提前 return 的实现同样不 Err（`round_folder` 自己吞掉了错误）。
#[tokio::test]
async fn folder_failure_does_not_block_the_webdav_half() {
    let fixture = env("dual-round-fail").await;

    /* 造一个「建不出目录」的落点：父级是普通文件，`create_dir_all` 必失败。 */
    let blocker = unique_dir("dual-blocker");
    fs::create_dir_all(&blocker).expect("建父目录");
    let occupied = blocker.join("occupied");
    fs::write(&occupied, b"x").expect("写占位文件");
    let bad_root = occupied.join("sub");

    let mut cfg = config::load(&fixture.pool).await.expect("读配置");
    cfg.cloud_folder = Some(MdSyncCloudChannel {
        enabled: true,
        local_root: bad_root.display().to_string(),
        ..Default::default()
    });
    cfg.cloud_webdav = Some(MdSyncCloudChannel {
        enabled: true,
        base_url: "https://dav.example.com".into(),
        base_path: "/Timing".into(),
        user: "tester".into(),
        ..Default::default()
    });
    config::save(&fixture.pool, &cfg).await.expect("存配置");

    let outcome = md_cloud::round(&fixture.pool)
        .await
        .expect("两条通路各自记错，round 本身不该 Err");
    let errors = &outcome.report.errors;
    assert!(
        errors.iter().any(|err| err.contains("建不了云端落点目录")),
        "folder 那一半必须报错（夹具造错了？）：{errors:?}"
    );
    /* webdav 那一半的错文案随环境不同（缺密码 / 系统凭据不可用），所以只判「除 folder
       那条之外还有一条」——提前 return 的实现这里只有一条。 */
    assert!(
        errors.len() >= 2,
        "本地轮失败不许挡住云端轮：webdav 那一半的错也必须出现（{errors:?}）"
    );

    let _ = fs::remove_dir_all(&blocker);
}

/// 调度链的单通路轮：只跑被点名的那一条，另一条连判据都不进。
#[tokio::test]
async fn round_channel_runs_only_the_asked_channel() {
    let fixture = env("dual-round-channel").await;
    let folder_root = unique_dir("dual-folder-root");
    fs::create_dir_all(&folder_root).expect("建本地落点");
    /* 有一条已保存记录，镜像那一步才会真的写出文件（空库时三档都「没什么可写」）。 */
    let item = new_item(&fixture.pool, "写作").await;
    let now = now_ms();
    insert_saved(&fixture.pool, item, now - 600_000, now, 600).await;

    let mut cfg = config::load(&fixture.pool).await.expect("读配置");
    cfg.cloud_folder = Some(MdSyncCloudChannel {
        enabled: true,
        local_root: folder_root.display().to_string(),
        ..Default::default()
    });
    /* webdav 故意配成「开着但没密码」：跑不跑得看 `round_channel` 认不认通路。 */
    cfg.cloud_webdav = Some(MdSyncCloudChannel {
        enabled: true,
        base_url: "https://dav.example.com".into(),
        base_path: "/Timing".into(),
        user: "tester".into(),
        ..Default::default()
    });
    config::save(&fixture.pool, &cfg).await.expect("存配置");

    /* ① 点名 folder：本地那份必须真的写出来，且**不许**冒出云端缺密码的错。 */
    let outcome = md_cloud::round_channel(&fixture.pool, PurgeChannel::Folder)
        .await
        .expect("folder 轮");
    assert!(
        outcome.report.errors.is_empty(),
        "只跑 folder，不该冒出 webdav 的错：{:?}",
        outcome.report.errors
    );
    let today = md_cloud::today();
    assert!(
        folder_root.join(format!("{today}.md")).exists(),
        "folder 轮必须把今天的文件写进本地落点"
    );

    /* ② 点名 webdav：本地那一半一次都不许跑，云端那份错照报。 */
    let before = fs::read_dir(&folder_root).expect("列目录").count();
    let outcome = md_cloud::round_channel(&fixture.pool, PurgeChannel::Webdav)
        .await
        .expect("webdav 轮");
    assert!(
        !outcome.report.errors.is_empty(),
        "点名 webdav 就该报它自己的错（缺密码 / 凭据不可用）：{:?}",
        outcome.report.errors
    );
    assert_eq!(
        fs::read_dir(&folder_root).expect("列目录").count(),
        before,
        "点名 webdav 时不该碰 folder 的落点"
    );

    let _ = fs::remove_dir_all(&folder_root);
}
