//! `snapshot.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use futures_util::FutureExt;
use sqlx::Executor;
use std::panic::AssertUnwindSafe;

pub(super) struct SnapshotTestDirectory(pub(super) PathBuf);

impl SnapshotTestDirectory {
    pub(super) fn new(label: &str) -> Self {
        let parent = std::env::temp_dir()
            .canonicalize()
            .expect("resolve temporary directory");
        Self(create_private_work_dir(&parent, label).expect("create test directory"))
    }
}

impl Drop for SnapshotTestDirectory {
    fn drop(&mut self) {
        let resolved = match self.0.canonicalize() {
            Ok(path) => path,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return,
            Err(error) => {
                eprintln!("failed to resolve snapshot test directory for cleanup: {error}");
                return;
            }
        };
        if resolved != self.0
            || resolved.parent() != std::env::temp_dir().canonicalize().ok().as_deref()
        {
            eprintln!(
                "snapshot test directory moved outside its owned temporary path; retaining it"
            );
            return;
        }
        if let Err(error) = fs::remove_dir_all(resolved) {
            eprintln!("failed to clean snapshot test directory: {error}");
        }
    }
}

#[test]
fn snapshot_format_is_explicit_and_not_the_legacy_format() {
    assert_eq!(SNAPSHOT_FORMAT, "PatinaSQLiteSnapshot-1");
    assert_ne!(SNAPSHOT_FORMAT, "PatinaBackup");
}

#[tokio::test]
async fn snapshot_replace_preparation_rejects_failed_schedule_reset() {
    use futures_util::FutureExt;
    for table in ["scheduled_export_config", "scheduled_backup_config"] {
        let pool = sqlx::SqlitePool::connect("sqlite::memory:").await.unwrap();
        let outcome = std::panic::AssertUnwindSafe(async {
            for migration in crate::services::insight::data::schema::tracker_migrations() {
                pool.execute(migration.sql).await.unwrap();
            }
            pool.execute("INSERT INTO scheduled_backup_config VALUES(1,1,'daily',NULL,0,'local','C:\\backup',NULL,1,'candidate-backup',0,0);
                INSERT INTO scheduled_export_config VALUES(1,1,'daily',NULL,0,'C:\\export','csv','[]','candidate-export',0,0);").await.unwrap();
            pool.execute(format!("CREATE TRIGGER reject_reset BEFORE UPDATE ON {table} BEGIN SELECT RAISE(ABORT, 'restore reset denied'); END").as_str()).await.unwrap();
            restore::prepare_snapshot_restore(&pool, 10000, crate::services::insight::data::backup::RestoreStrategy::Merge).await.unwrap();
            let result = restore::prepare_snapshot_restore(&pool, 10000, crate::services::insight::data::backup::RestoreStrategy::Replace).await;
            assert!(result.is_err(), "{table}: candidate accepted without disabling restored schedules");
            assert!(result.unwrap_err().contains("restore reset denied"));
            let enabled: (i64,i64) = sqlx::query_as("SELECT (SELECT enabled FROM scheduled_backup_config),(SELECT enabled FROM scheduled_export_config)")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(enabled, (1,1), "both resets must roll back together");
            pool.execute("DROP TRIGGER reject_reset").await.unwrap();
            restore::prepare_snapshot_restore(&pool, 10000, crate::services::insight::data::backup::RestoreStrategy::Replace).await.unwrap();
            let enabled: (i64,i64) = sqlx::query_as("SELECT (SELECT enabled FROM scheduled_backup_config),(SELECT enabled FROM scheduled_export_config)")
                .fetch_one(&pool).await.unwrap();
            assert_eq!(enabled, (0,0));
        }).catch_unwind().await;
        pool.close().await;
        if let Err(panic) = outcome {
            std::panic::resume_unwind(panic);
        }
    }
}

#[test]
fn sha256_is_stable() {
    assert_eq!(
        sha256_bytes(b"patina"),
        "d94f56e94b0baa931ff993ad4fb39e4726e3ff182e889e8c9003cdd6e6b0b484"
    );
}

#[tokio::test]
async fn snapshot_archive_round_trips_a_consistent_database() {
    let work_dir = SnapshotTestDirectory::new("patina-snapshot-test");
    let db_path = work_dir.0.join("source.db");
    let archive_path = work_dir.0.join("backup.zip");
    let mut pools = Vec::new();
    // Keep the extracted directory alive until every registered SQLite pool has closed.
    let mut extracted = None;
    let outcome = AssertUnwindSafe(async {
        let pool = crate::services::insight::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, true)
            .await
            .expect("open source database");
        pools.push(pool.clone());
        crate::services::insight::data::sqlite_pool::prepare_pool_schema(&pool, &db_path)
            .await
            .expect("prepare source schema");
        sqlx::query("INSERT INTO settings (key, value) VALUES ('snapshot-test', 'preserved')")
            .execute(&pool)
            .await
            .expect("insert source row");
        sqlx::query(
            "INSERT INTO import_batches (
            id, imported_at, source_name, source_kind, source_fingerprint,
            exact_session_count, hour_bucket_count
         ) VALUES ('backup-batch', 1, 'external.csv', 'patina-csv', 'source', 1, 1)",
        )
        .execute(&pool)
        .await
        .expect("insert import batch");
        sqlx::query(
            "INSERT INTO import_exact_sessions (
            batch_id, fingerprint, app_name, exe_name, window_title,
            start_time, end_time, duration
         ) VALUES ('backup-batch', 'exact', 'External', 'external.exe', '', 10, 20, 10)",
        )
        .execute(&pool)
        .await
        .expect("insert external exact session");
        sqlx::query(
            "INSERT INTO import_time_buckets (
            batch_id, fingerprint, app_name, exe_name, bucket_start_time, duration
         ) VALUES ('backup-batch', 'bucket', 'External', 'external.exe', 0, 10)",
        )
        .execute(&pool)
        .await
        .expect("insert external hour bucket");
        crate::services::insight::data::repositories::anonymous_activity::observe(&pool, 30, true)
            .await
            .unwrap();
        crate::services::insight::data::repositories::anonymous_activity::seal(&pool, 60)
            .await
            .unwrap();
        let anonymous =
            crate::services::insight::data::repositories::anonymous_activity::read_range(&pool, 0, 100)
                .await
                .unwrap();
        assert_eq!(read_counts(&pool).await.unwrap().anonymous_activity, 1);

        let preview = write_snapshot_archive(&pool, &archive_path, "test")
            .await
            .expect("write snapshot archive");
        assert_eq!(preview.format_kind, "sqlite_snapshot");
        assert_eq!(preview.setting_count, 1);
        assert_eq!(preview.import_batch_count, 1);
        assert_eq!(preview.import_exact_session_count, 1);
        assert_eq!(preview.import_time_bucket_count, 1);

        extracted = Some(
            extract_snapshot_archive(&archive_path, true)
                .await
                .expect("extract snapshot archive"),
        );
        let restored_pool = open_snapshot_pool(&extracted.as_ref().unwrap().db_path, true)
            .await
            .expect("open extracted database");
        pools.push(restored_pool.clone());
        let value: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'snapshot-test'")
                .fetch_one(&restored_pool)
                .await
                .expect("read extracted row");
        let external_counts: (i64, i64, i64) = sqlx::query_as(
            "SELECT
            (SELECT COUNT(*) FROM import_batches),
            (SELECT COUNT(*) FROM import_exact_sessions),
            (SELECT COUNT(*) FROM import_time_buckets)",
        )
        .fetch_one(&restored_pool)
        .await
        .expect("read extracted external rows");
        assert_eq!(value, "preserved");
        assert_eq!(external_counts, (1, 1, 1));
        assert_eq!(
            crate::services::insight::data::repositories::anonymous_activity::read_range(&restored_pool, 0, 100)
                .await
                .unwrap(),
            anonymous
        );
    })
    .catch_unwind()
    .await;
    for pool in pools {
        pool.close().await;
    }
    drop(extracted);
    let cleanup = fs::remove_dir_all(&work_dir.0);
    drop(work_dir);
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    cleanup.expect("remove test directory");
}

#[tokio::test]
async fn older_migration_prefix_is_verified_before_current_table_counts() {
    use sqlx::migrate::{Migrate, Migration, MigrationType};

    let work_dir = SnapshotTestDirectory::new("patina-old-snapshot-test");
    let db_path = work_dir.0.join("old.db");
    let mut pools = Vec::new();
    let outcome = AssertUnwindSafe(async {
        let pool = crate::services::insight::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, true)
            .await
            .expect("open source database");
        pools.push(pool.clone());
        let old_head = schema::WEB_ACTIVITY_SESSION_MIGRATION_VERSION - 1;
        let mut connection = pool.acquire().await.expect("acquire source connection");
        connection
            .ensure_migrations_table()
            .await
            .expect("create migration history");
        for migration in schema::tracker_migrations()
            .into_iter()
            .filter(|migration| migration.version <= old_head)
        {
            connection
                .apply(&Migration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    migration.sql.into(),
                    false,
                ))
                .await
                .expect("apply supported old migration");
        }
        drop(connection);
        assert_eq!(
            migration_metadata(&pool).await.expect("read old prefix"),
            (
                old_head,
                expected_migration_fingerprint(old_head).expect("known old prefix")
            )
        );
        assert!(
            !crate::services::insight::data::schema_contracts::has_web_activity_session_schema(&pool)
                .await
                .expect("old schema omits the current native web relation")
        );
        assert!(
            !crate::services::insight::data::schema_contracts::has_session_range_index(&pool)
                .await
                .expect("old schema omits the later range index")
        );
        pool.execute(
            "INSERT INTO tool_timers(mode, accumulated_ms, status, created_at, updated_at)
            VALUES('stopwatch', 0, 'running', 1000, 1000);
            INSERT INTO tool_timer_laps(timer_id, lap_index, started_at, ended_at, duration_ms)
            VALUES(1, 1, 1000, 2000, 1000);",
        )
        .await
        .unwrap();
        pool.close().await;

        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.to_string(),
            product: "Patina".to_string(),
            created_at_ms: now_ms(),
            app_version: "old".to_string(),
            database: SnapshotDatabaseManifest {
                path: DATABASE_ENTRY.to_string(),
                size_bytes: 1,
                sha256: "0".repeat(64),
                migration_head: old_head,
                migration_fingerprint: expected_migration_fingerprint(old_head)
                    .expect("known migration prefix"),
            },
            restore: SnapshotRestoreManifest {
                strategies: vec!["replace".to_string(), "merge".to_string()],
            },
            counts: SnapshotCounts::default(),
        };

        assert!(verify_extracted_database(&db_path, &manifest, false)
            .await
            .expect("old schema prefix should reach migration"));

        let migration_pool =
            crate::services::insight::data::sqlite_pool::open_single_connection_sqlite_pool(&db_path, false)
                .await
                .expect("open old schema for migration");
        pools.push(migration_pool.clone());
        crate::services::insight::data::sqlite_pool::prepare_pool_schema(&migration_pool, &db_path)
            .await
            .expect("migrate old schema");
        validate_current_schema(&migration_pool)
            .await
            .expect("migrated schema should expose all current tables");
        assert!(
            crate::services::insight::data::schema_contracts::has_retired_timer(&migration_pool)
                .await
                .unwrap()
        );
    })
    .catch_unwind()
    .await;
    for pool in pools {
        pool.close().await;
    }
    let cleanup = fs::remove_dir_all(&work_dir.0);
    drop(work_dir);
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
    cleanup.expect("remove test directory");
}

#[test]
fn publishing_over_an_existing_backup_keeps_the_target_path_valid() {
    let work_dir = SnapshotTestDirectory::new("patina-publish-test");
    let target = work_dir.0.join("backup.zip");
    let replacement = work_dir.0.join("replacement.zip");
    fs::write(&target, b"old").expect("write old backup");
    fs::write(&replacement, b"new").expect("write replacement backup");

    publish_archive_atomically(&replacement, &target).expect("replace backup atomically");

    assert_eq!(fs::read(&target).expect("read published backup"), b"new");
    assert!(!replacement.exists());
    fs::remove_dir_all(&work_dir.0).expect("remove test directory");
}

#[test]
fn create_new_publish_never_overwrites_an_unknown_target() {
    let work_dir = SnapshotTestDirectory::new("patina-create-new-test");
    let target = work_dir.0.join("backup.zip");
    let replacement = work_dir.0.join("replacement.zip");
    fs::write(&target, b"unknown").expect("write unknown target");
    fs::write(&replacement, b"scheduled").expect("write replacement");

    assert_eq!(
        publish_archive_create_new(&replacement, &target),
        Err(CreateNewPublishError::AlreadyExists)
    );
    assert_eq!(fs::read(&target).expect("read target"), b"unknown");
    assert_eq!(
        fs::read(&replacement).expect("read retained replacement"),
        b"scheduled"
    );
    fs::remove_dir_all(&work_dir.0).expect("remove test directory");
}

#[test]
fn non_zip_files_are_not_misclassified_as_snapshots() {
    let work_dir = SnapshotTestDirectory::new("patina-format-test");
    let path = work_dir.0.join("legacy.json");
    fs::write(&path, br#"{"version":1}"#).expect("write legacy file");
    assert!(!is_snapshot_archive(&path).expect("inspect legacy file"));
    fs::remove_dir_all(&work_dir.0).expect("remove test directory");
}

#[tokio::test]
async fn snapshot_reader_rejects_traversal_entries_before_extraction() {
    let work_dir = SnapshotTestDirectory::new("patina-unsafe-zip-test");
    let path = work_dir.0.join("unsafe.zip");
    let file = File::create(&path).expect("create unsafe archive");
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default();
    for name in ["../manifest.json", CHECKSUMS_ENTRY, DATABASE_ENTRY] {
        zip.start_file(name, options).expect("start unsafe entry");
        zip.write_all(b"invalid").expect("write unsafe entry");
    }
    zip.finish().expect("finish unsafe archive");

    let error = extract_snapshot_archive(&path, false)
        .await
        .err()
        .expect("unsafe archive must be rejected");
    assert!(error.contains("unsafe") || error.contains("unexpected file set"));
    fs::remove_dir_all(&work_dir.0).expect("remove test directory");
}

#[tokio::test]
async fn snapshot_reader_rejects_inconsistent_local_header_names() {
    let work_dir = SnapshotTestDirectory::new("patina-header-consistency-test");
    let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    write_zip_entry(
        &mut zip,
        MANIFEST_ENTRY,
        br#"{"format":"PatinaSQLiteSnapshot-1"}"#,
    )
    .unwrap();
    write_zip_entry(&mut zip, CHECKSUMS_ENTRY, b"{}").unwrap();
    write_zip_entry(&mut zip, DATABASE_ENTRY, b"fixture").unwrap();
    let original = zip.finish().unwrap().into_inner();
    for name in [MANIFEST_ENTRY, CHECKSUMS_ENTRY, DATABASE_ENTRY] {
        let mut archive = ZipArchive::new(std::io::Cursor::new(&original)).unwrap();
        let offset = archive.by_name(name).unwrap().header_start() as usize;
        let mut bytes = original.clone();
        assert_eq!(&bytes[offset..offset + 4], b"PK\x03\x04");
        bytes[offset + 30] ^= 1;
        let path = work_dir.0.join("mismatched.zip");
        fs::write(&path, &bytes).unwrap();
        let error = extract_snapshot_archive(&path, false)
            .await
            .err()
            .expect("inconsistent headers must be rejected");
        assert!(error.contains("header inconsistency"), "{name}: {error}");
        if name == MANIFEST_ENTRY {
            assert!(!is_snapshot_archive(&path).unwrap());
        }
        assert_eq!(fs::read(&path).unwrap(), bytes);
    }
}

#[tokio::test]
async fn snapshot_reader_rejects_duplicate_entries() {
    let work_dir = SnapshotTestDirectory::new("patina-duplicate-zip-test");
    let path = work_dir.0.join("duplicate.zip");
    let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default();
    for name in [MANIFEST_ENTRY, "manifesu.json", DATABASE_ENTRY] {
        zip.start_file(name, options)
            .expect("start duplicate entry");
        zip.write_all(b"invalid").expect("write duplicate entry");
    }
    let mut bytes = zip.finish().expect("finish duplicate archive").into_inner();
    for index in 0..bytes.len().saturating_sub(b"manifesu.json".len()) {
        if &bytes[index..index + b"manifesu.json".len()] == b"manifesu.json" {
            bytes[index..index + b"manifest.json".len()].copy_from_slice(b"manifest.json");
        }
    }
    fs::write(&path, bytes).expect("write duplicate archive");

    let error = extract_snapshot_archive(&path, false)
        .await
        .err()
        .expect("duplicate archive must be rejected");
    let normalized = error.to_ascii_lowercase();
    assert!(
        normalized.contains("duplicate") || normalized.contains("unexpected file set"),
        "{error}"
    );
    fs::remove_dir_all(&work_dir.0).expect("remove test directory");
}

#[tokio::test]
async fn snapshot_reader_enforces_metadata_database_limits_and_hashes() {
    let work_dir = SnapshotTestDirectory::new("patina-snapshot-limits-test");
    let database = b"small database fixture rejected before SQLite parsing";
    for case in [
        "manifest-limit",
        "checksums-limit",
        "database-limit",
        "manifest-hash",
        "database-hash",
    ] {
        let declared_size = if case == "database-limit" {
            MAX_DATABASE_BYTES + 1
        } else {
            database.len() as u64
        };
        let database_hash = if case == "database-hash" {
            "0".repeat(64)
        } else {
            sha256_bytes(database)
        };
        let manifest = SnapshotManifest {
            format: SNAPSHOT_FORMAT.into(),
            product: "Patina".into(),
            created_at_ms: 1,
            app_version: "test".into(),
            database: SnapshotDatabaseManifest {
                path: DATABASE_ENTRY.into(),
                size_bytes: declared_size,
                sha256: database_hash.clone(),
                migration_head: 0,
                migration_fingerprint: "not reached".into(),
            },
            restore: SnapshotRestoreManifest {
                strategies: vec!["replace".into(), "merge".into()],
            },
            counts: SnapshotCounts::default(),
        };
        let mut manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        let checksums = SnapshotChecksums {
            algorithm: "sha256".into(),
            files: BTreeMap::from([
                (
                    MANIFEST_ENTRY.into(),
                    if case == "manifest-hash" {
                        "0".repeat(64)
                    } else {
                        sha256_bytes(&manifest_bytes)
                    },
                ),
                (DATABASE_ENTRY.into(), database_hash),
            ]),
        };
        let mut checksum_bytes = serde_json::to_vec(&checksums).unwrap();
        if case == "manifest-limit" {
            manifest_bytes = vec![b' '; MAX_METADATA_BYTES as usize + 1];
        }
        if case == "checksums-limit" {
            checksum_bytes = vec![b' '; MAX_METADATA_BYTES as usize + 1];
        }
        let mut zip = ZipWriter::new(std::io::Cursor::new(Vec::new()));
        write_zip_entry(&mut zip, MANIFEST_ENTRY, &manifest_bytes).unwrap();
        write_zip_entry(&mut zip, CHECKSUMS_ENTRY, &checksum_bytes).unwrap();
        write_zip_entry(&mut zip, DATABASE_ENTRY, database).unwrap();
        let mut bytes = zip.finish().unwrap().into_inner();
        if case == "database-limit" {
            // Keep both headers consistent while declaring an oversized database.
            let end = bytes.len() - 22;
            assert_eq!(&bytes[end..end + 4], b"PK\x05\x06");
            let mut cursor =
                u32::from_le_bytes(bytes[end + 16..end + 20].try_into().unwrap()) as usize;
            let mut patched = 0;
            for _ in 0..3 {
                assert_eq!(&bytes[cursor..cursor + 4], b"PK\x01\x02");
                let name_len =
                    u16::from_le_bytes(bytes[cursor + 28..cursor + 30].try_into().unwrap())
                        as usize;
                let extra_len =
                    u16::from_le_bytes(bytes[cursor + 30..cursor + 32].try_into().unwrap())
                        as usize;
                let comment_len =
                    u16::from_le_bytes(bytes[cursor + 32..cursor + 34].try_into().unwrap())
                        as usize;
                if &bytes[cursor + 46..cursor + 46 + name_len] == DATABASE_ENTRY.as_bytes() {
                    bytes[cursor + 24..cursor + 28]
                        .copy_from_slice(&(declared_size as u32).to_le_bytes());
                    let local =
                        u32::from_le_bytes(bytes[cursor + 42..cursor + 46].try_into().unwrap())
                            as usize;
                    assert_eq!(&bytes[local..local + 4], b"PK\x03\x04");
                    bytes[local + 22..local + 26]
                        .copy_from_slice(&(declared_size as u32).to_le_bytes());
                    patched += 1;
                }
                cursor += 46 + name_len + extra_len + comment_len;
            }
            assert_eq!(patched, 1);
            let mut inspected = ZipArchive::new(std::io::Cursor::new(&bytes)).unwrap();
            assert_eq!(
                inspected.by_name(DATABASE_ENTRY).unwrap().size(),
                MAX_DATABASE_BYTES + 1
            );
            assert!(
                bytes.len() < 4096,
                "fixture must not allocate a large database"
            );
        }
        let path = work_dir.0.join(format!("{case}.zip"));
        fs::write(&path, bytes).unwrap();
        let error = extract_snapshot_archive(&path, false)
            .await
            .err()
            .expect("invalid snapshot must be rejected");
        let expected = match case {
            "manifest-limit" => "snapshot metadata entry `manifest.json` is too large",
            "checksums-limit" => "snapshot metadata entry `checksums.json` is too large",
            "database-limit" => "snapshot database size is invalid",
            "manifest-hash" => "snapshot manifest checksum mismatch",
            "database-hash" => "snapshot database checksum mismatch",
            _ => unreachable!(),
        };
        assert_eq!(error, expected, "{case}");
    }
    let path = work_dir.0.clone();
    drop(work_dir);
    assert!(!path.exists());
}
