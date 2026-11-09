//! `sqlite_pool.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use sqlx::{Executor, SqlitePool};

async fn create_sqlx_migrations_table(pool: &SqlitePool) {
    pool.execute(
        "CREATE TABLE _sqlx_migrations (
            version BIGINT PRIMARY KEY,
            description TEXT NOT NULL,
            installed_on TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
            success BOOLEAN NOT NULL,
            checksum BLOB NOT NULL,
            execution_time BIGINT NOT NULL
        )",
    )
    .await
    .unwrap();
}

#[test]
fn current_baseline_migration_creates_complete_schema() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(has_current_baseline_schema(&pool).await.unwrap());
    });
}

#[test]
fn tools_schema_creates_complete_tool_tables() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();

        assert!(has_base_tools_schema(&pool).await.unwrap());
        assert!(!has_software_reminder_rules_schema(&pool).await.unwrap());
    });
}

#[test]
fn software_reminder_schema_creates_rule_table() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(has_software_reminder_rules_schema(&pool).await.unwrap());
    });
}

#[test]
fn web_activity_schema_creates_complete_table() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();

        assert!(has_web_activity_schema(&pool).await.unwrap());
    });
}

#[test]
fn web_favicon_cache_schema_creates_table_and_backfills_segments() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool.execute(
            "INSERT INTO web_activity_segments (
                browser_client_id, browser_kind, browser_exe_name, domain,
                normalized_domain, url, title, favicon_url, start_time,
                end_time, duration, source, created_at, updated_at
             ) VALUES
                ('client', 'chrome', 'chrome.exe', 'GitHub', 'github.com',
                 NULL, 'Newer URL icon', 'https://github.com/favicon.ico', 200, 250, 50,
                 'browser-extension', 200, 200),
                ('client', 'chrome', 'chrome.exe', 'GitHub', 'github.com',
                 NULL, 'Older data icon', 'data:image/png;base64,github', 100, 150, 50,
                 'browser-extension', 100, 100),
                ('client', 'chrome', 'chrome.exe', 'Docs', 'docs.rs',
                 NULL, 'Docs', 'https://docs.rs/favicon.ico', 300, 350, 50,
                 'browser-extension', 300, 300)",
        )
        .await
        .unwrap();

        pool.execute(schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(has_web_favicon_cache_schema(&pool).await.unwrap());

        let github: (String, i64) = sqlx::query_as(
            "SELECT favicon_url, updated_at
             FROM web_favicon_cache
             WHERE normalized_domain = 'github.com'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let docs: (String, i64) = sqlx::query_as(
            "SELECT favicon_url, updated_at
             FROM web_favicon_cache
             WHERE normalized_domain = 'docs.rs'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();

        assert_eq!(github, ("data:image/png;base64,github".to_string(), 100));
        assert_eq!(docs, ("https://docs.rs/favicon.ico".to_string(), 300));
    });
}

#[test]
fn import_data_schema_creates_complete_tables_and_indexes() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(has_import_data_schema(&pool).await.unwrap());
        assert!(!table_exists(&pool, "import_exact_records").await.unwrap());
    });
}

#[test]
fn import_data_schema_rejects_migration_guard_residue() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(
            "CREATE TABLE import_exact_migration_guard (
                valid INTEGER NOT NULL CHECK(valid = 1)
             )",
        )
        .await
        .unwrap();

        assert!(!has_import_data_schema(&pool).await.unwrap());
    });
}

#[test]
fn import_data_schema_rejects_a_cascade_path_to_native_sessions() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(
            "DROP TABLE import_exact_sessions;
             CREATE TABLE import_exact_sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                batch_id TEXT NOT NULL,
                fingerprint TEXT NOT NULL UNIQUE,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT NOT NULL DEFAULT '',
                start_time INTEGER NOT NULL,
                end_time INTEGER NOT NULL,
                duration INTEGER NOT NULL,
                source_category TEXT,
                source_path TEXT,
                FOREIGN KEY(batch_id) REFERENCES import_batches(id) ON DELETE CASCADE,
                FOREIGN KEY(id) REFERENCES sessions(id) ON DELETE CASCADE
             );
             CREATE INDEX idx_import_exact_sessions_time
             ON import_exact_sessions(start_time, end_time);
             CREATE INDEX idx_import_exact_sessions_exe_time
             ON import_exact_sessions(exe_name COLLATE NOCASE, start_time, end_time);
             CREATE INDEX idx_import_exact_sessions_batch
             ON import_exact_sessions(batch_id, id);",
        )
        .await
        .unwrap();

        assert!(!has_import_data_schema(&pool).await.unwrap());
    });
}

#[test]
fn import_isolation_migration_moves_only_import_owned_sessions() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute("PRAGMA foreign_keys = ON").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES
                ('Native', 'same.exe', 'Native title', 100, 200, 100, 100),
                ('External', 'same.exe', 'External title', 300, 500, 200, 300);
             INSERT INTO session_title_samples (
                session_id, title, start_time, end_time
             ) VALUES (2, 'External title', 300, 500);
             INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES ('batch-1', 1, 'source.csv', 'patina-csv', 'source', 1, 0);
             INSERT INTO import_exact_records (
                batch_id, session_id, fingerprint, source_category, source_path
             ) VALUES ('batch-1', 2, 'record', 'Work', 'C:\\same.exe');",
        )
        .await
        .unwrap();

        pool.execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap();

        let native: (String, String, String, i64, i64, i64) = sqlx::query_as(
            "SELECT app_name, exe_name, window_title, start_time, end_time, duration
             FROM sessions",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            native,
            (
                "Native".to_string(),
                "same.exe".to_string(),
                "Native title".to_string(),
                100,
                200,
                100,
            )
        );
        let imported: (String, String, String, i64, i64, i64, String, String) = sqlx::query_as(
            "SELECT app_name, exe_name, window_title, start_time, end_time, duration,
                        source_category, source_path
                 FROM import_exact_sessions",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            imported,
            (
                "External".to_string(),
                "same.exe".to_string(),
                "External title".to_string(),
                300,
                500,
                200,
                "Work".to_string(),
                "C:\\same.exe".to_string(),
            )
        );
        let title_sample_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title_sample_count, 0);
        assert!(!table_exists(&pool, "import_exact_records").await.unwrap());
    });
}

#[test]
fn import_isolation_migration_fails_closed_on_orphaned_ownership() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect("sqlite::memory:")
            .await
            .unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        pool.execute("PRAGMA foreign_keys = OFF").await.unwrap();
        pool.execute(
            "INSERT INTO import_batches (
                id, imported_at, source_name, source_kind, source_fingerprint,
                exact_session_count, hour_bucket_count
             ) VALUES ('batch-1', 1, 'source.csv', 'patina-csv', 'source', 1, 0);
             INSERT INTO import_exact_records (
                batch_id, session_id, fingerprint, source_category, source_path
             ) VALUES ('batch-1', 999, 'record', NULL, NULL);",
        )
        .await
        .unwrap();

        let mut tx = pool.begin().await.unwrap();
        let error = tx
            .execute(schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
            .await
            .unwrap_err();
        tx.rollback().await.unwrap();

        assert!(error.to_string().contains("CHECK constraint failed"));
        let old_record_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM import_exact_records")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(old_record_count, 1);
        assert!(!table_exists(&pool, "import_exact_sessions").await.unwrap());
    });
}

#[test]
fn current_v6_schema_is_normalized_then_advanced_to_isolated_schema() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::IMPORT_DATA_SCHEMA_SQL).await.unwrap();
        create_sqlx_migrations_table(&pool).await;

        assert!(has_import_data_v6_schema(&pool).await.unwrap());
        assert!(!has_import_data_schema(&pool).await.unwrap());
        normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();
        let recorded_versions: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(recorded_versions, vec![1, 2, 3, 4, 5, 6]);

        run_current_migrations(&pool).await.unwrap();

        assert!(has_import_data_schema(&pool).await.unwrap());
        assert!(has_activity_read_models_schema(&pool).await.unwrap());
        assert!(!table_exists(&pool, "import_exact_records").await.unwrap());
        let final_versions: Vec<i64> =
            sqlx::query_scalar("SELECT version FROM _sqlx_migrations ORDER BY version")
                .fetch_all(&pool)
                .await
                .unwrap();
        assert_eq!(
            final_versions,
            schema::tracker_migrations()
                .into_iter()
                .map(|migration| migration.version)
                .collect::<Vec<_>>()
        );
    });
}

#[test]
fn schema_inspection_coverage_matches_registered_migration_head() {
    validate_schema_inspection_coverage().unwrap();
}

#[test]
fn current_schema_history_is_normalized_to_single_baseline_row() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0),
                    (7, 'old_v7', 1, x'07', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let expected = expected_migration_metadata();

        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].get::<i64, _>("version"), expected[0].0);
        assert_eq!(rows[0].get::<String, _>("description"), expected[0].1);
        assert_eq!(rows[0].get::<Vec<u8>, _>("checksum"), expected[0].2);
    });
}

#[test]
fn current_schema_history_preserves_tools_schema_row() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let mut expected = expected_migration_metadata();
        expected.truncate(2);

        assert_eq!(rows.len(), expected.len());
        for (version, description, checksum) in expected {
            assert!(rows.iter().any(|row| {
                row.get::<i64, _>("version") == version
                    && row.get::<String, _>("description") == description
                    && row.get::<Vec<u8>, _>("checksum") == checksum
            }));
        }
    });
}

#[test]
fn current_schema_history_preserves_software_reminder_schema_row() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0),
                    (3, 'old_v3', 1, x'03', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let mut expected = expected_migration_metadata();
        expected.truncate(3);

        assert_eq!(rows.len(), expected.len());
        for (version, description, checksum) in expected {
            assert!(rows.iter().any(|row| {
                row.get::<i64, _>("version") == version
                    && row.get::<String, _>("description") == description
                    && row.get::<Vec<u8>, _>("checksum") == checksum
            }));
        }
    });
}

#[test]
fn current_schema_history_does_not_mark_missing_web_activity_schema_as_applied() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0),
                    (3, 'old_v3', 1, x'03', 0),
                    (4, 'old_v4_without_table', 1, x'04', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        assert!(!has_web_activity_schema(&pool).await.unwrap());

        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let mut expected = expected_migration_metadata();
        expected.truncate(3);

        assert_eq!(rows.len(), expected.len());
        for (version, description, checksum) in expected {
            assert!(rows.iter().any(|row| {
                row.get::<i64, _>("version") == version
                    && row.get::<String, _>("description") == description
                    && row.get::<Vec<u8>, _>("checksum") == checksum
            }));
        }

        run_current_migrations(&pool).await.unwrap();
        assert!(has_web_activity_schema(&pool).await.unwrap());
    });
}

#[test]
fn current_schema_history_does_not_mark_missing_web_favicon_cache_as_applied() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0),
                    (3, 'old_v3', 1, x'03', 0),
                    (4, 'old_v4', 1, x'04', 0),
                    (5, 'old_v5_without_table', 1, x'05', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        assert!(!has_web_favicon_cache_schema(&pool).await.unwrap());

        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let mut expected = expected_migration_metadata();
        expected.truncate(4);

        assert_eq!(rows.len(), expected.len());
        for (version, description, checksum) in expected {
            assert!(rows.iter().any(|row| {
                row.get::<i64, _>("version") == version
                    && row.get::<String, _>("description") == description
                    && row.get::<Vec<u8>, _>("checksum") == checksum
            }));
        }

        run_current_migrations(&pool).await.unwrap();
        assert!(has_web_favicon_cache_schema(&pool).await.unwrap());
    });
}

#[test]
fn current_schema_history_does_not_mark_missing_import_data_schema_as_applied() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(schema::WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
        pool.execute(schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0),
                    (2, 'old_v2', 1, x'02', 0),
                    (3, 'old_v3', 1, x'03', 0),
                    (4, 'old_v4', 1, x'04', 0),
                    (5, 'old_v5', 1, x'05', 0),
                    (6, 'old_v6_without_tables', 1, x'06', 0)",
        )
        .await
        .unwrap();

        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        assert!(!table_exists(&pool, "import_batches").await.unwrap());
        assert!(!table_exists(&pool, "import_exact_records").await.unwrap());
        assert!(!table_exists(&pool, "import_time_buckets").await.unwrap());

        let rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
            .fetch_all(&pool)
            .await
            .unwrap();
        let mut expected = expected_migration_metadata();
        expected.truncate(5);

        assert_eq!(rows.len(), expected.len());
        for (version, description, checksum) in expected {
            assert!(rows.iter().any(|row| {
                row.get::<i64, _>("version") == version
                    && row.get::<String, _>("description") == description
                    && row.get::<Vec<u8>, _>("checksum") == checksum
            }));
        }

        run_current_migrations(&pool).await.unwrap();
        assert!(table_exists(&pool, "import_batches").await.unwrap());
        assert!(!table_exists(&pool, "import_exact_records").await.unwrap());
        assert!(table_exists(&pool, "import_exact_sessions").await.unwrap());
        assert!(table_exists(&pool, "import_time_buckets").await.unwrap());
    });
}

#[test]
fn missing_import_index_is_repaired_by_the_idempotent_migration() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_current_migrations(&pool).await.unwrap();
        pool.execute("DROP INDEX idx_import_time_buckets_exe_time")
            .await
            .unwrap();

        assert!(!has_import_data_schema(&pool).await.unwrap());
        normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();
        run_current_migrations(&pool).await.unwrap();

        assert!(has_import_data_schema(&pool).await.unwrap());
        assert!(has_current_schema(&pool).await.unwrap());
    });
}

#[test]
fn partial_import_table_schema_fails_closed() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        run_current_migrations(&pool).await.unwrap();
        pool.execute("ALTER TABLE import_time_buckets DROP COLUMN source_path")
            .await
            .unwrap();

        let error = prepare_pool_schema(&pool, Path::new("partial-import-schema.db"))
            .await
            .unwrap_err();

        assert!(error.contains("sqlite schema validation failed"));
        assert!(!has_import_data_schema(&pool).await.unwrap());
    });
}

async fn create_legacy_schema_without_continuity_column(pool: &SqlitePool) {
    pool.execute(
        "CREATE TABLE sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            app_name TEXT NOT NULL,
            exe_name TEXT NOT NULL,
            window_title TEXT,
            start_time INTEGER NOT NULL,
            end_time INTEGER,
            duration INTEGER
        );
        CREATE INDEX idx_sessions_date ON sessions(start_time);
        CREATE UNIQUE INDEX idx_sessions_single_active ON sessions((1)) WHERE end_time IS NULL;
        CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE icon_cache (
            exe_name TEXT PRIMARY KEY,
            icon_base64 TEXT NOT NULL,
            last_updated INTEGER
        );",
    )
    .await
    .unwrap();
}

#[test]
fn legacy_schema_without_continuity_column_is_repaired() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_legacy_schema_without_continuity_column(&pool).await;

        let repaired = repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();

        assert!(repaired);
        assert!(sessions_has_column(&pool, "continuity_group_start_time")
            .await
            .unwrap());
        assert!(has_current_baseline_schema(&pool).await.unwrap());
    });
}

#[test]
fn legacy_schema_repair_preserves_existing_sessions() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_legacy_schema_without_continuity_column(&pool).await;
        pool.execute(
            "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES ('Editor', 'editor.exe', 'Doc', 100, 150, 50),
                    ('Browser', 'browser.exe', 'Page', 200, NULL, NULL)",
        )
        .await
        .unwrap();

        repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 2);
    });
}

#[test]
fn legacy_schema_repair_backfills_continuity_group_start_time() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_legacy_schema_without_continuity_column(&pool).await;
        pool.execute(
            "INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES ('Editor', 'editor.exe', 'Doc', 321, 654, 333)",
        )
        .await
        .unwrap();

        repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();

        let continuity_group_start_time: i64 =
            sqlx::query_scalar("SELECT continuity_group_start_time FROM sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(continuity_group_start_time, 321);
    });
}

#[test]
fn legacy_schema_repair_then_normalizes_migration_history() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_legacy_schema_without_continuity_column(&pool).await;
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0)",
        )
            .await
            .unwrap();

        repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();
        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(normalized);
        let description: String =
            sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(description, schema::CURRENT_BASELINE_MIGRATION_DESCRIPTION);
    });
}

#[test]
fn legacy_schema_repair_dedupes_active_sessions() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER
            );
            CREATE INDEX idx_sessions_date ON sessions(start_time);
            CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE icon_cache (
                exe_name TEXT PRIMARY KEY,
                icon_base64 TEXT NOT NULL,
                last_updated INTEGER
            );
            INSERT INTO sessions (app_name, exe_name, window_title, start_time, end_time, duration)
            VALUES ('A', 'a.exe', 'A', 100, NULL, NULL),
                   ('B', 'b.exe', 'B', 200, NULL, NULL);",
        )
        .await
        .unwrap();

        repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();

        let active_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        let sealed_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE duration = 0")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(active_count, 1);
        assert_eq!(sealed_count, 1);
        assert!(sessions_has_index(&pool, "idx_sessions_single_active")
            .await
            .unwrap());
    });
}

#[test]
fn current_baseline_includes_title_samples_table_and_indexes() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(table_exists(&pool, "session_title_samples").await.unwrap());
        assert!(table_has_index(
            &pool,
            "session_title_samples",
            "idx_session_title_samples_session_time",
        )
        .await
        .unwrap());
        assert!(table_has_index(
            &pool,
            "session_title_samples",
            "idx_session_title_samples_time",
        )
        .await
        .unwrap());
        assert!(has_current_baseline_schema(&pool).await.unwrap());
    });
}

#[test]
fn legacy_schema_repair_creates_title_samples_and_backfills_once() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        create_legacy_schema_without_continuity_column(&pool).await;
        pool.execute(
            "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration)
             VALUES (1, 'Editor', 'editor.exe', 'Doc', 100, 150, 50),
                    (2, 'Browser', 'browser.exe', '', 200, 250, 50)",
        )
        .await
        .unwrap();

        assert!(repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap());
        assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap());

        let samples: Vec<(i64, String, i64, Option<i64>)> = sqlx::query_as(
            "SELECT session_id, title, start_time, end_time
             FROM session_title_samples
             ORDER BY id ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(samples, vec![(1, "Doc".to_string(), 100, Some(150))]);
        assert!(has_current_baseline_schema(&pool).await.unwrap());
    });
}

#[test]
fn current_schema_repair_is_idempotent() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();

        assert!(!repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap());
        assert!(has_current_baseline_schema(&pool).await.unwrap());
    });
}

#[test]
fn incomplete_schema_is_not_marked_as_current_baseline() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(
            "CREATE TABLE sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                app_name TEXT NOT NULL,
                exe_name TEXT NOT NULL,
                window_title TEXT,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                duration INTEGER
            );",
        )
        .await
        .unwrap();
        create_sqlx_migrations_table(&pool).await;
        pool.execute(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (1, 'old_v1', 1, x'01', 0)",
        )
        .await
        .unwrap();

        repair_legacy_schema_before_baseline_normalization(&pool)
            .await
            .unwrap();
        let normalized = normalize_current_baseline_migration_history_for_pool(&pool)
            .await
            .unwrap();

        assert!(!normalized);
        let description: String =
            sqlx::query_scalar("SELECT description FROM _sqlx_migrations WHERE version = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(description, "old_v1");
    });
}
