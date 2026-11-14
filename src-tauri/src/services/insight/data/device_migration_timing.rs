//! 迁移 28 在**真实规模老库**上的耗时实测（`#[ignore]`：要有人主动跑才算数）。
//!
//! 造库方式与生产升级路径逐字节一致：用同一份 `tracker_migrations()` 只跑到 27，
//! 账本/checksum 都是真的，然后插 13375 行会话（`TIMING_PARITY_ROWS` 可改），
//! 关库重开，再分别给「迁移 28」与「认领哨兵行」计时。
//!
//! 跑法：
//! ```text
//! cargo +1.100.0 test --lib device_dimension_migration_duration -- --ignored --nocapture
//! ```

use crate::services::insight::data::schema_registry;
use crate::services::insight::data::sqlite_pool::open_single_connection_sqlite_pool;
use sqlx::migrate::{Migrate, Migration as SqlxMigration, MigrationType};
use sqlx::Executor;
use std::time::Instant;

/// 老库规模。默认值 = 任务书给的那台机器（13375 条会话）。
fn fixture_rows() -> i64 {
    std::env::var("TIMING_PARITY_ROWS")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(13_375)
}

#[test]
#[ignore = "measures migration 28 on a 13375-row database; run with --ignored --nocapture"]
fn device_dimension_migration_duration_on_an_old_database() {
    tauri::async_runtime::block_on(async {
        let rows = fixture_rows();
        let dir = std::env::temp_dir().join(format!("timing-mig28-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("patina.db");

        // ① 造一个真的「停在 27」的库。
        let pool = open_single_connection_sqlite_pool(&path, true).await.unwrap();
        let mut connection = pool.acquire().await.unwrap();
        connection.ensure_migrations_table().await.unwrap();
        for migration in schema_registry::tracker_migrations()
            .into_iter()
            .filter(|migration| migration.version < schema_registry::DEVICE_DIMENSION_MIGRATION_VERSION)
        {
            connection
                .apply(&SqlxMigration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    migration.sql.into(),
                    false,
                ))
                .await
                .unwrap();
        }
        drop(connection);
        pool.execute(
            format!(
                "WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i+1<{rows})
                 INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
                 SELECT 'Editor', 'editor.exe', i*1000, i*1000+500, 500 FROM n"
            )
            .as_str(),
        )
        .await
        .unwrap();
        pool.close().await;

        // ② 像真正的冷启动那样重开，两段分开计时。
        let pool = open_single_connection_sqlite_pool(&path, false).await.unwrap();
        let started = Instant::now();
        crate::services::insight::schema_core::ensure_schema_at(&pool, &path)
            .await
            .unwrap();
        let migration = started.elapsed();
        let started = Instant::now();
        let adopted = crate::services::insight::schema_core::adopt_local_rows(&pool, "0123456789ab")
            .await
            .unwrap();
        let adopt = started.elapsed();

        let sentinel: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE device_id = ''")
                .fetch_one(&pool)
                .await
                .unwrap();
        let null_uid: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE uid IS NULL")
            .fetch_one(&pool)
            .await
            .unwrap();
        println!("rows = {rows}");
        println!("migration 28 = {migration:?}（sqlx 把它包在**一个**事务里，所以独占写锁就持这么久）");
        println!("adopt_local_rows = {adopt:?}（rows_affected = {adopted}）");
        println!("sentinel rows left = {sentinel}, null uid left = {null_uid}");
        assert_eq!(sentinel, 0);
        assert_eq!(null_uid, 0);
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    });
}
