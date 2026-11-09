//! `import_data.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::{load_external_import_backup_from_pool, merge_external_import_backup_in_tx};
use crate::patina::data::backup::merge::merge_backup_records_in_tx;
use crate::patina::data::schema::{
    ACTIVITY_REMINDER_RULES_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL,
    IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
    SOFTWARE_REMINDER_RULES_SCHEMA_SQL, TOOLS_TABLES_SCHEMA_SQL, WEB_ACTIVITY_SCHEMA_SQL,
    WEB_FAVICON_CACHE_SCHEMA_SQL,
};
use crate::patina::domain::backup::{BackupRecords, BackupSession};
use sqlx::{Executor, Pool, Row, Sqlite};

async fn setup_pool() -> Pool<Sqlite> {
    let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
    pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
    pool.execute(TOOLS_TABLES_SCHEMA_SQL).await.unwrap();
    pool.execute(SOFTWARE_REMINDER_RULES_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(ACTIVITY_REMINDER_RULES_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::patina::data::schema::ACTIVITY_REMINDER_EXTENSION_SQL)
        .await
        .unwrap();
    pool.execute(crate::patina::data::schema::ACTIVITY_REMINDER_ENABLED_SQL)
        .await
        .unwrap();
    pool.execute(crate::patina::data::schema::REMINDER_RECURRENCE_SQL)
        .await
        .unwrap();
    pool.execute(crate::patina::data::schema::REMINDER_IDENTITY_SQL)
        .await
        .unwrap();
    pool.execute(crate::patina::data::schema::ACTIVITY_REMINDER_UNIQUE_TARGET_SQL)
        .await
        .unwrap();
    pool.execute(WEB_ACTIVITY_SCHEMA_SQL).await.unwrap();
    pool.execute(WEB_FAVICON_CACHE_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
        .await
        .unwrap();
    for schema in [
        crate::patina::data::schema::SCHEDULED_BACKUP_SCHEMA_SQL,
        crate::patina::data::schema::SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL,
        crate::patina::data::schema::SCHEDULED_EXPORT_SCHEMA_SQL,
    ] {
        pool.execute(schema).await.unwrap();
    }
    pool
}

async fn insert_batch(
    pool: &Pool<Sqlite>,
    id: &str,
    fingerprint_suffix: &str,
    exact_fingerprint: &str,
    bucket_fingerprint: &str,
) {
    sqlx::query(
        "INSERT INTO import_batches (
            id, imported_at, source_name, source_kind, source_fingerprint,
            exact_session_count, hour_bucket_count
         ) VALUES (?, 100, 'external.csv', 'patina-csv', ?, 1, 1)",
    )
    .bind(id)
    .bind(format!("source-{fingerprint_suffix}"))
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_exact_sessions (
            batch_id, fingerprint, app_name, exe_name, window_title,
            start_time, end_time, duration, source_category
         ) VALUES (?, ?, 'External', 'external.exe', 'Window', 1000, 2000, 1000, 'Work')",
    )
    .bind(id)
    .bind(exact_fingerprint)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_time_buckets (
            batch_id, fingerprint, app_name, exe_name,
            bucket_start_time, duration, source_category
         ) VALUES (?, ?, 'External', 'external.exe', 0, 1000, 'Work')",
    )
    .bind(id)
    .bind(bucket_fingerprint)
    .execute(pool)
    .await
    .unwrap();
}

fn payload_with_native_session(exe_name: &str) -> BackupRecords {
    BackupRecords {
        free_focus_tasks: vec![],
        sessions: vec![BackupSession {
            id: 100,
            app_name: "Backup Native".to_string(),
            exe_name: exe_name.to_string(),
            window_title: Some("Backup Window".to_string()),
            start_time: 3_000,
            end_time: Some(4_000),
            duration: Some(1_000),
            continuity_group_start_time: Some(3_000),
        }],
        title_samples: Vec::new(),
        settings: Vec::new(),
        icon_cache: Vec::new(),
        web_activity_segments: Vec::new(),
        web_favicon_cache: Vec::new(),
        tool_reminders: Vec::new(),
        tool_pomodoro_runs: Vec::new(),
        tool_daily_stats: Vec::new(),
    }
}

#[tokio::test]
async fn merge_keeps_native_sessions_and_is_idempotent() {
    let source = setup_pool().await;
    insert_batch(&source, "source-batch", "one", "exact-one", "bucket-one").await;
    let target = setup_pool().await;
    sqlx::query(
        "INSERT INTO sessions (
            app_name, exe_name, window_title, start_time, end_time, duration,
            continuity_group_start_time
         ) VALUES ('Native', 'native.exe', 'Native', 10, 20, 10, 10)",
    )
    .execute(&target)
    .await
    .unwrap();

    let backup = load_external_import_backup_from_pool(&source)
        .await
        .unwrap();
    for _ in 0..2 {
        let mut tx = target.begin().await.unwrap();
        merge_external_import_backup_in_tx(&mut tx, &backup)
            .await
            .unwrap();
        tx.commit().await.unwrap();
    }

    let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&target)
        .await
        .unwrap();
    let external_counts: (i64, i64, i64) = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM import_batches) AS batches,
            (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
            (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
    )
    .fetch_one(&target)
    .await
    .map(|row| (row.get("batches"), row.get("exacts"), row.get("buckets")))
    .unwrap();
    assert_eq!(native_count, 1);
    assert_eq!(external_counts, (1, 1, 1));
}

#[tokio::test]
async fn merge_remaps_a_conflicting_batch_id_without_overwriting() {
    let source = setup_pool().await;
    insert_batch(
        &source,
        "shared-id",
        "source",
        "exact-source",
        "bucket-source",
    )
    .await;
    let target = setup_pool().await;
    insert_batch(
        &target,
        "shared-id",
        "target",
        "exact-target",
        "bucket-target",
    )
    .await;

    let backup = load_external_import_backup_from_pool(&source)
        .await
        .unwrap();
    let mut tx = target.begin().await.unwrap();
    merge_external_import_backup_in_tx(&mut tx, &backup)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let batch_ids: Vec<String> =
        sqlx::query_scalar("SELECT id FROM import_batches ORDER BY id")
            .fetch_all(&target)
            .await
            .unwrap();
    assert_eq!(batch_ids.len(), 2);
    assert!(batch_ids.iter().any(|id| id == "shared-id"));
    assert!(batch_ids.iter().any(|id| id.starts_with("restore-")));
}

#[tokio::test]
async fn merge_keeps_equal_fingerprints_when_record_types_differ() {
    let source = setup_pool().await;
    insert_batch(&source, "source", "source", "shared", "shared").await;
    let target = setup_pool().await;

    let backup = load_external_import_backup_from_pool(&source)
        .await
        .unwrap();
    let mut tx = target.begin().await.unwrap();
    merge_external_import_backup_in_tx(&mut tx, &backup)
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let external_counts: (i64, i64) = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
            (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
    )
    .fetch_one(&target)
    .await
    .map(|row| (row.get("exacts"), row.get("buckets")))
    .unwrap();
    assert_eq!(external_counts, (1, 1));
}

#[tokio::test]
async fn native_merge_preserves_current_external_data() {
    let pool = setup_pool().await;
    insert_batch(
        &pool,
        "current",
        "current",
        "exact-current",
        "bucket-current",
    )
    .await;

    let mut tx = pool.begin().await.unwrap();
    merge_backup_records_in_tx(&mut tx, &payload_with_native_session("backup.exe"))
        .await
        .unwrap();
    tx.commit().await.unwrap();

    let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .unwrap();
    let external_counts: (i64, i64, i64) = sqlx::query(
        "SELECT
            (SELECT COUNT(*) FROM import_batches) AS batches,
            (SELECT COUNT(*) FROM import_exact_sessions) AS exacts,
            (SELECT COUNT(*) FROM import_time_buckets) AS buckets",
    )
    .fetch_one(&pool)
    .await
    .map(|row| (row.get("batches"), row.get("exacts"), row.get("buckets")))
    .unwrap();
    assert_eq!(native_count, 1);
    assert_eq!(external_counts, (1, 1, 1));
}

#[tokio::test]
async fn combined_restore_rolls_back_native_when_external_merge_fails() {
    let source = setup_pool().await;
    insert_batch(&source, "source", "source", "exact-source", "bucket-source").await;
    let mut backup = load_external_import_backup_from_pool(&source)
        .await
        .unwrap();
    backup.batches[0].time_buckets[0].duration = 0;

    let target = setup_pool().await;
    let mut tx = target.begin().await.unwrap();
    merge_backup_records_in_tx(&mut tx, &payload_with_native_session("rolled-back.exe"))
        .await
        .unwrap();
    let error = merge_external_import_backup_in_tx(&mut tx, &backup)
        .await
        .unwrap_err();
    assert!(error.contains("failed to restore external hour bucket"));
    tx.rollback().await.unwrap();

    let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&target)
        .await
        .unwrap();
    let external_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_batches")
        .fetch_one(&target)
        .await
        .unwrap();
    assert_eq!(native_count, 0);
    assert_eq!(external_count, 0);
}
