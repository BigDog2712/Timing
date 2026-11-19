//! 设备维度迁移的验收用例（T02）。
//!
//! 为什么单独一个文件而不是塞进 `sqlite_pool_mod_tests.rs`：那个文件已冻结在 994 行，
//! 而这里要钉的东西（迁移 28 真的跑过、哨兵被认领、重启两次不退化）**不属于**
//! 「sqlite pool 的旧行为」，属于这一版的新契约。
//!
//! ⚠️ 其中最贵的一条是 `prepare_pool_schema_twice_preserves_migration_28`：它守的是
//! `normalize_current_baseline_migration_history_for_pool` 那个「整表重写
//! `_sqlx_migrations`」的危险分支——一旦它把 version 28 那行删掉，下次启动重跑迁移 28
//! 就会撞 `duplicate column name`，老用户开机即挂。第一次启动是绿的，第二次才红。

use crate::services::activity::data::schema_registry;
use crate::services::activity::data::sqlite_pool::{
    open_single_connection_sqlite_pool, prepare_pool_schema,
};
use sqlx::{Row, SqlitePool};
use std::path::Path;

/// 迁移头必须与登记表最后一条一致（`schema_registry` + `sqlite_pool` 两处同源）。
#[test]
fn registered_head_matches_the_sync_bookkeeping_version() {
    let head = schema_registry::tracker_migrations()
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default();
    assert_eq!(head, schema_registry::head_version());
    assert_eq!(head, 31, "这一轮把 head 抬到了媒体播放采样（31）");
}

/// 生成列的 DDL 依赖 SQLite ≥ 3.31；sqlx 带的是 bundled 版本，这里钉一次实际值。
///
/// 降级到系统 libsqlite3 时这条断言会先红，而不是让用户在「装不上」时才看到
/// `near "AS": syntax error`。
#[test]
fn bundled_sqlite_supports_generated_columns() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        let version: String = sqlx::query_scalar("SELECT sqlite_version()")
            .fetch_one(&pool)
            .await
            .unwrap();
        let mut parts = version.split('.');
        let major: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
        let minor: u32 = parts.next().unwrap_or("0").parse().unwrap_or(0);
        assert!(
            (major, minor) >= (3, 31),
            "bundled sqlite {version} is older than 3.31 (generated columns)"
        );
    });
}

/// 空库走到 head 28 之后，设备维度的列/索引/表全都在。
#[test]
fn fresh_database_reaches_device_dimension_head() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        prepare_pool_schema(&pool, Path::new(":memory:"))
            .await
            .unwrap();

        let columns = session_columns(&pool).await;
        for required in ["device_id", "uid", "app_key", "updated_at_ms", "synced_seq"] {
            assert!(
                columns.iter().any(|c| c == required),
                "missing sessions.{required}"
            );
        }
        assert!(has_index(&pool, "uq_sessions_open_per_device").await);
        assert!(!has_index(&pool, "idx_sessions_single_active").await);
        assert!(has_index(&pool, "uq_sessions_uid").await);
        assert!(has_index(&pool, "idx_sessions_pending").await);
        assert!(table_exists(&pool, "devices").await);
        assert!(table_exists(&pool, "activity_daily_totals").await);
        assert_eq!(applied_head(&pool).await, 31);
        // 本机身份写进 devices 且恰好一行 is_self=1。
        let self_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE is_self = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(self_rows, 1);
        // 空库上没有哨兵行。
        let sentinel: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ''")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(sentinel, 0);
    });
}

/// 插入会话后 uid 由触发器发，且带 `s:` 前缀；同一设备第二条 open 被唯一索引挡下。
#[test]
fn open_sessions_are_unique_per_device_and_uid_is_issued_by_the_database() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        prepare_pool_schema(&pool, Path::new(":memory:"))
            .await
            .unwrap();
        let device_id = self_device_id(&pool).await;

        insert_session(&pool, &device_id, 1_000, None).await;
        insert_session(&pool, "ffffffffffff", 2_000, None).await;
        let row = sqlx::query("SELECT uid FROM sessions WHERE device_id = ?1")
            .bind(&device_id)
            .fetch_one(&pool)
            .await
            .unwrap();
        let uid: Option<String> = row.get("uid");
        assert!(
            uid.as_deref().is_some_and(|value| value.starts_with("s:")),
            "{uid:?}"
        );

        // 同一设备第二条 open：必须失败。
        let error = insert_session_raw(&pool, &device_id, 3_000)
            .await
            .unwrap_err();
        // SQLite 报的是表与列，不是索引名。
        assert!(
            error.to_string().contains("sessions.device_id"),
            "unexpected error: {error}"
        );
    });
}

/// 重启（再跑一遍 prepare）不得回退：迁移 28 那行还在、哨兵不再出现、另一台设备的
/// open 会话不被清零。这条同时守 R2（按旧索引名修复会把别的设备清零）与
/// `_sqlx_migrations` 被改写（R3）。
#[test]
fn prepare_pool_schema_twice_preserves_migration_28_and_open_sessions() {
    tauri::async_runtime::block_on(async {
        let dir = std::env::temp_dir().join(format!(
            "timing-device-restart-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("patina.db");

        let first = open_single_connection_sqlite_pool(&db_path, true)
            .await
            .unwrap();
        prepare_pool_schema(&first, &db_path).await.unwrap();
        let device_id = self_device_id(&first).await;
        insert_session(&first, &device_id, 1_000, None).await;
        insert_session(&first, "ffffffffffff", 2_000, None).await;
        first.close().await;

        // 第二次启动：迁移 28 已应用，这里跑的是「什么都不该发生」的那条路。
        let second = open_single_connection_sqlite_pool(&db_path, true)
            .await
            .unwrap();
        prepare_pool_schema(&second, &db_path).await.unwrap();

        assert_eq!(applied_head(&second).await, 31);
        let open_rows: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                .fetch_one(&second)
                .await
                .unwrap();
        assert_eq!(
            open_rows, 2,
            "restart must not seal the other device's open session"
        );
        let sentinel: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ''")
                .fetch_one(&second)
                .await
                .unwrap();
        assert_eq!(sentinel, 0);
        let self_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM devices WHERE is_self = 1")
            .fetch_one(&second)
            .await
            .unwrap();
        assert_eq!(self_rows, 1);
        second.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    });
}

/// 生产库升级路径（`#[ignore]`：需要真实库）。
///
/// 跑法：
/// ```text
/// sqlite3 %APPDATA%\com.timing.app\Patina\data\patina.db "VACUUM INTO 'D:/tmp/p1-v27.db'"
/// set TIMING_PARITY_DB=D:/tmp/p1-v27.db
/// cargo +1.100.0 test --lib device_schema_upgrade -- --ignored --nocapture
/// ```
#[test]
#[ignore = "needs TIMING_PARITY_DB pointing at a copy of a real pre-28 patina.db"]
fn device_schema_upgrade() {
    let path = std::env::var("TIMING_PARITY_DB").expect("TIMING_PARITY_DB");
    tauri::async_runtime::block_on(async {
        let db_path = Path::new(&path);
        let pool = open_single_connection_sqlite_pool(db_path, false)
            .await
            .unwrap();
        let before: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        let started = std::time::Instant::now();
        prepare_pool_schema(&pool, db_path).await.unwrap();
        let elapsed = started.elapsed();
        let after: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        let sentinel: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ''")
                .fetch_one(&pool)
                .await
                .unwrap();
        let null_uid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE uid IS NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
        println!("migration elapsed: {elapsed:?}");
        println!("sessions before={before} after={after} sentinel={sentinel} null_uid={null_uid}");
        assert_eq!(
            sentinel, 0,
            "every row must be adopted into a real device id"
        );
        assert_eq!(after, before, "migration must not add or drop rows");
        assert_eq!(applied_head(&pool).await, 31);
        pool.close().await;
    });
}

async fn insert_session(
    pool: &SqlitePool,
    device_id: &str,
    start_time: i64,
    end_time: Option<i64>,
) {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, device_id)
         VALUES ('App', 'app.exe', '', ?1, ?2, ?3, ?4)",
    )
    .bind(start_time)
    .bind(end_time)
    .bind(end_time.map(|end| end - start_time))
    .bind(device_id)
    .execute(pool)
    .await
    .unwrap();
}

async fn insert_session_raw(
    pool: &SqlitePool,
    device_id: &str,
    start_time: i64,
) -> Result<(), sqlx::Error> {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, device_id)
         VALUES ('App', 'app.exe', '', ?1, NULL, NULL, ?2)",
    )
    .bind(start_time)
    .bind(device_id)
    .execute(pool)
    .await
    .map(|_| ())
}

async fn self_device_id(pool: &SqlitePool) -> String {
    sqlx::query_scalar("SELECT install_id FROM devices WHERE is_self = 1")
        .fetch_one(pool)
        .await
        .unwrap()
}

/// `PRAGMA table_xinfo` 而不是 `table_info`：`app_key` 是**生成列**，
/// SQLite 只在 `table_xinfo` 里列它。
async fn session_columns(pool: &SqlitePool) -> Vec<String> {
    sqlx::query("PRAGMA table_xinfo(sessions)")
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| row.get::<String, _>("name"))
        .collect()
}

async fn has_index(pool: &SqlitePool, name: &str) -> bool {
    sqlx::query("PRAGMA index_list(sessions)")
        .fetch_all(pool)
        .await
        .unwrap()
        .into_iter()
        .any(|row| row.get::<String, _>("name") == name)
}

async fn table_exists(pool: &SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .unwrap()
        > 0
}

async fn applied_head(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT MAX(version) FROM _sqlx_migrations")
        .fetch_one(pool)
        .await
        .unwrap()
}
