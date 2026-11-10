//! 云端待传队列（V0.11.13，验收 4 / 5）：迁移不丢数据 + 队列三态。
//!
//! 断言口径是**行为**，不是实现细节：迁移之后老数据的行数与内容必须一字不差，
//! 欠账时间不能被第二次「有改动」刷掉，上传成功必须留下 etag 与指纹。

use sqlx::SqlitePool;

use crate::infra::migrate;
use crate::models::md_cloud_purge::PurgeChannel;
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::models::md_sync_config::MdSyncConfig;
use crate::repositories::md_cloud_pending as repo;
use crate::tests::support::{exec, fresh_pool, insert_saved, new_item, scalar_i64, scalar_opt_str};

async fn table_exists(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("查询 sqlite_master 应成功")
}

/// 某张表的行数。
async fn count(pool: &SqlitePool, table: &str) -> i64 {
    scalar_i64(pool, &format!("SELECT COUNT(*) FROM {table}")).await
}

/// 把库退回到「v5 时代」：结构上等同只跑过 0001–0005 —— 没有 `md_cloud_pending`，
/// `schema.version = '5'`。这样测的是「老库升到 v6」这条真实路径，而不是新库。
async fn downgrade_to_v5(pool: &SqlitePool) {
    exec(pool, "DROP TABLE md_cloud_pending").await;
    exec(
        pool,
        "UPDATE settings SET value = '5' WHERE key = 'schema.version'",
    )
    .await;
}

/// 验收 4：老库（v5）上跑完整迁移链，既有数据一行不丢、一条不改。
#[tokio::test]
async fn migration_keeps_existing_rows() {
    let pool = fresh_pool("cloud-mig").await;
    downgrade_to_v5(&pool).await;
    assert_eq!(table_exists(&pool, "md_cloud_pending").await, 0);

    // 老数据：两个事项、两条已保存记录、两条待办、一张便利贴。
    new_item(&pool, "写作").await;
    new_item(&pool, "读书").await;
    insert_saved(&pool, 2, 1_700_000_000_000, 1_700_000_600_000, 600).await;
    insert_saved(&pool, 3, 1_700_003_600_000, 1_700_004_200_000, 600).await;
    exec(
        &pool,
        "INSERT INTO todos (title, sort_order, created_at, updated_at) \
         VALUES ('周报', 0, 1000, 1000), ('买牛奶', 1, 2000, 2000)",
    )
    .await;
    exec(
        &pool,
        "INSERT INTO notes (item_id, content, pos_x, pos_y, width, height, created_at, updated_at) \
         VALUES (2, '灵感一', 10.0, 20.0, 200.0, 160.0, 3000, 3000)",
    )
    .await;

    const TABLES: [&str; 4] = ["items", "time_records", "todos", "notes"];
    let mut before = [0i64; 4];
    for (index, table) in TABLES.iter().enumerate() {
        before[index] = count(&pool, table).await;
    }

    // 老库 → 完整迁移链（= 启动时 `init_pool` 做的事）。
    migrate::migrate(&pool).await.expect("v5 -> v6 迁移应成功");

    assert_eq!(table_exists(&pool, "md_cloud_pending").await, 1);
    assert_eq!(
        scalar_opt_str(
            &pool,
            "SELECT value FROM settings WHERE key = 'schema.version'"
        )
        .await
        .as_deref(),
        Some("7")
    );
    for (index, table) in TABLES.iter().enumerate() {
        assert_eq!(
            count(&pool, table).await,
            before[index],
            "{table} 的行数不该被迁移改动"
        );
    }
    /* 行数相同还不够：迁移写错表（比如误 UPDATE settings 之外的东西）时行数也相同。
    这里再加两条内容断言，钉住「一个字节都没改」。 */
    assert_eq!(
        scalar_opt_str(&pool, "SELECT content FROM notes WHERE id = 1")
            .await
            .as_deref(),
        Some("灵感一")
    );
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT SUM(accumulated_sec) FROM time_records WHERE deleted_at IS NULL"
        )
        .await,
        1200
    );
    // 新表应可用且为空：迁移不预置任何一行（欠账是运行时事实）。
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM md_cloud_pending").await,
        0
    );

    // 幂等：再跑一次不报错、数据仍不变。
    migrate::migrate(&pool).await.expect("重复迁移应幂等");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items").await,
        before[0]
    );
}

/// 验收 5：队列三态 —— 有改动 / 仍欠账（时间不重置）/ 已上传。
#[tokio::test]
async fn pending_queue_three_states() {
    let pool = fresh_pool("cloud-queue").await;
    let today = "2026-11-06";

    assert!(
        repo::get(&pool, PurgeChannel::Webdav, today).await.expect("查询应成功").is_none(),
        "还没改过时不应有行"
    );

    // ① 本地内容变了：登记欠账。
    repo::mark_pending(&pool, PurgeChannel::Webdav, today, "hash-a", 1_000)
        .await
        .expect("mark_pending 应成功");
    let row = repo::get(&pool, PurgeChannel::Webdav, today)
        .await
        .expect("查询应成功")
        .expect("登记后应有行");
    assert_eq!(row.pending_since, 1_000);
    assert_eq!(row.last_hash.as_deref(), Some("hash-a"));
    assert_eq!(row.etag, None, "还没传成功过，不该有 etag");
    assert!(row.is_pending());
    assert_eq!(
        repo::pending_dates(&pool, PurgeChannel::Webdav).await.expect("查询应成功"),
        vec![today.to_string()]
    );

    // ② 又改了一次：`pending_since` 必须还是第一次那个时刻。
    repo::mark_pending(&pool, PurgeChannel::Webdav, today, "hash-b", 5_000)
        .await
        .expect("重复 mark_pending 应成功");
    let row = repo::get(&pool, PurgeChannel::Webdav, today)
        .await
        .expect("查询应成功")
        .expect("行应仍在");
    assert_eq!(
        row.pending_since, 1_000,
        "pending_since 记的是「第一次发现有未传改动」，第二次不许重置"
    );
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM md_cloud_pending").await,
        1,
        "同一天只应有一行（主键 upsert）"
    );

    // 升序：昨天的欠账排在今天前面。
    repo::mark_pending(&pool, PurgeChannel::Webdav, "2026-11-05", "hash-old", 2_000)
        .await
        .expect("mark_pending 应成功");
    assert_eq!(
        repo::pending_dates(&pool, PurgeChannel::Webdav).await.expect("查询应成功"),
        vec!["2026-11-05".to_string(), today.to_string()]
    );

    // ③ 上传成功：欠账归 0，同时留下 etag 与指纹。
    repo::mark_synced(&pool, PurgeChannel::Webdav, today, Some("W/\"abc\""), "hash-b")
        .await
        .expect("mark_synced 应成功");
    let row = repo::get(&pool, PurgeChannel::Webdav, today)
        .await
        .expect("查询应成功")
        .expect("行应仍在");
    assert_eq!(row.pending_since, 0, "上传成功必须清账");
    assert_eq!(row.etag.as_deref(), Some("W/\"abc\""));
    assert_eq!(row.last_hash.as_deref(), Some("hash-b"));
    assert!(!row.is_pending());
    assert_eq!(
        repo::pending_dates(&pool, PurgeChannel::Webdav).await.expect("查询应成功"),
        vec!["2026-11-05".to_string()],
        "已传的那天要从补传清单里消失"
    );

    // 清掉一行后 get 回到 None；list 仍按 date 升序。
    repo::clear(&pool, PurgeChannel::Webdav, "2026-11-05")
        .await
        .expect("clear 应成功");
    assert!(
        repo::get(&pool, PurgeChannel::Webdav, "2026-11-05")
            .await
            .expect("查询应成功")
            .is_none()
    );
    let all = repo::list(&pool, PurgeChannel::Webdav).await.expect("list 应成功");
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].date, today);
}

fn binding(kind: MdSyncKind, root: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind,
        enabled: true,
        root: root.into(),
        file: "{date}.md".into(),
        heading: format!("#### {}", kind.label()),
    }
}

fn cloud(mode: CloudMode) -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode,
        ..Default::default()
    }
}

/// 云端本地目录与任一落点解析后相同 → 拒绝（同一个文件不能有两个写者）。
#[test]
fn cloud_folder_must_not_share_a_root_with_bindings() {
    let mut folder = cloud(CloudMode::LocalFolder);
    folder.local_root = r"d:/VAULT/".into();
    let config = MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: vec![binding(MdSyncKind::Timers, r"D:\vault")],
        cloud: Some(folder),
        ..MdSyncConfig::default()
    };
    let err = config
        .validate()
        .expect_err("与落点同目录必须被拒绝（大小写与分隔符差异不该让它漏过去）");
    assert!(err.contains("落点"), "原因要说清是跟落点撞了：{err}");

    // 换个目录就通过。
    let mut ok = cloud(CloudMode::LocalFolder);
    ok.local_root = r"D:\坚果云\Timing".into();
    let config = MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: vec![binding(MdSyncKind::Timers, r"D:\vault")],
        cloud: Some(ok),
        ..MdSyncConfig::default()
    };
    assert!(config.validate().is_ok());
}

/// WebDAV 的远端目录不许带 `..`，地址必须带协议头。
#[test]
fn cloud_webdav_rejects_parent_segment_and_bare_host() {
    let mut webdav = cloud(CloudMode::Webdav);
    webdav.base_url = "https://dav.jianguoyun.com/dav/".into();
    webdav.user = "me@example.com".into();
    webdav.base_path = "/Timing/../etc".into();
    let config = MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: vec![binding(MdSyncKind::Timers, r"D:\vault")],
        cloud: Some(webdav),
        ..MdSyncConfig::default()
    };
    assert!(config.validate().is_err(), ".. 段必须被拒绝");

    let mut webdav = cloud(CloudMode::Webdav);
    webdav.base_url = "dav.jianguoyun.com/dav".into();
    webdav.user = "me@example.com".into();
    webdav.base_path = "/Timing/md".into();
    assert_eq!(
        webdav.remote_dir().expect("规范化应成功"),
        "/Timing/md",
        "去首尾斜杠、统一成 / 分隔"
    );
    assert!(
        webdav.validate(&[]).is_err(),
        "没写协议头的地址必须被拒绝，否则用户只会看到 reqwest 的英文报错"
    );
}

/// 环境变量占位符要先展开再比：`%APP_DIR%\md` 与展开后的绝对路径是同一个目录。
#[test]
fn cloud_folder_expands_tokens_before_comparing() {
    let app_md = crate::infra::md_env::expand_env("%APP_DIR%\\md");
    let mut folder = cloud(CloudMode::LocalFolder);
    folder.local_root = "%APP_DIR%\\md".into();
    let err = folder
        .validate(&[binding(MdSyncKind::Notes, &app_md)])
        .expect_err("占位符与展开后的同一路径必须被认成同一个目录");
    assert!(err.contains("落点"), "{err}");
}
