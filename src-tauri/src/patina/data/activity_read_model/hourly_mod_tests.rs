//! `hourly.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::patina::data::schema::{
    ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL,
    IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
};
use sqlx::{Executor, SqlitePool};

async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(ACTIVITY_READ_MODELS_SCHEMA_SQL).await.unwrap();
    pool.execute(crate::patina::data::repositories::anonymous_activity::SCHEMA_SQL)
        .await
        .unwrap();
    pool
}

#[tokio::test]
async fn migration_triggers_mark_fact_changes_in_the_same_transaction() {
    let pool = setup_pool().await;
    let mut tx = pool.begin().await.unwrap();
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Code', 'Code.EXE', 10, 20, 10)",
    )
    .execute(&mut *tx)
    .await
    .unwrap();
    let revision: i64 =
        sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
            .fetch_one(&mut *tx)
            .await
            .unwrap();
    assert_eq!(revision, 1);
    tx.rollback().await.unwrap();
    let revision: i64 =
        sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(revision, 0);
    let dirty_count: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(dirty_count, 0);
}

#[tokio::test]
async fn migration_triggers_floor_negative_epoch_ranges_correctly() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Archive', 'archive.exe', -1000, -1, 999)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let native_range = sqlx::query(
        "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
         WHERE reason = 'native_insert'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(native_range.get::<i64, _>("start_ms"), -HOUR_MS);
    assert_eq!(native_range.get::<i64, _>("end_ms"), 0);

    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('negative', 1, 'fixture', 'csv', 'negative', 0, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration)
         VALUES ('negative', 'bucket', 'Archive', 'archive.exe', -1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let bucket_range = sqlx::query(
        "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
         WHERE reason = 'import_bucket_insert'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bucket_range.get::<i64, _>("start_ms"), -HOUR_MS);
    assert_eq!(bucket_range.get::<i64, _>("end_ms"), 0);
}

#[tokio::test]
async fn stale_worker_generation_never_clears_a_newer_dirty_signal() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Code', 'code.exe', 0, 1000, 1000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "UPDATE read_model_state SET state = 'ready', algorithm_version = 3, coverage_start_ms = 0,
                coverage_end_ms = 3600000 WHERE model_name = 'activity_hourly'",
    )
    .execute(&pool)
    .await
    .unwrap();
    let dirty = sqlx::query(
        "SELECT id, start_ms, end_ms, generation
         FROM activity_summary_dirty_ranges LIMIT 1",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    let dirty_id: i64 = dirty.get("id");
    let old_generation: i64 = dirty.get("generation");
    sqlx::query(
        "UPDATE activity_summary_dirty_ranges SET generation = generation + 1 WHERE id = ?",
    )
    .bind(dirty_id)
    .execute(&pool)
    .await
    .unwrap();

    process_dirty_batch(
        &pool,
        dirty_id,
        dirty.get("start_ms"),
        dirty.get("end_ms"),
        old_generation,
    )
    .await
    .unwrap();

    let surviving_generation: i64 =
        sqlx::query_scalar("SELECT generation FROM activity_summary_dirty_ranges WHERE id = ?")
            .bind(dirty_id)
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(surviving_generation, old_generation + 1);
}

#[tokio::test]
async fn dirty_rebuild_drains_a_bounded_bulk_write_batch_per_worker_turn() {
    let pool = setup_pool().await;
    for index in 0..200 {
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES (?, ?, ?, ?, 1000)",
        )
        .bind(format!("App {index}"))
        .bind(format!("app-{index}.exe"))
        .bind(index * 1000)
        .bind(index * 1000 + 1000)
        .execute(&pool)
        .await
        .unwrap();
    }
    sqlx::query(
        "UPDATE read_model_state SET state = 'ready', algorithm_version = 3, coverage_start_ms = 0,
                coverage_end_ms = 3600000 WHERE model_name = 'activity_hourly'",
    )
    .execute(&pool)
    .await
    .unwrap();

    maintain_once(&pool).await.unwrap();
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 200 - DIRTY_REBUILD_BATCH_SIZE);

    maintain_once(&pool).await.unwrap();
    let remaining: i64 =
        sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(remaining, 0);
}

#[tokio::test]
async fn rebuild_matches_global_native_exact_and_bucket_precedence() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind,
           source_fingerprint, exact_session_count, hour_bucket_count)
         VALUES ('batch', 1, 'fixture', 'csv', 'fixture', 1, 1)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_exact_sessions(batch_id, fingerprint, app_name, exe_name,
           start_time, end_time, duration)
         VALUES ('batch', 'exact', 'Exact App', 'exact.exe', 0, 3600000, 3600000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration)
         VALUES ('batch', 'bucket', 'Bucket App', 'bucket.exe', 0, 3600000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Native App', 'native.exe', 900000, 1800000, 900000)",
    )
    .execute(&pool)
    .await
    .unwrap();
    let facts = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(facts.read_path, "facts");
    initialize_backfill(&pool).await.unwrap();
    process_backfill_batch(&pool, 0, 3600000).await.unwrap();
    finish_backfill(&pool).await.unwrap();

    let total: i64 =
        sqlx::query_scalar("SELECT SUM(effective_duration_ms) FROM activity_hourly_effective")
            .fetch_one(&pool)
            .await
            .unwrap();
    assert_eq!(total, 3600000);
    let native: i64 = sqlx::query_scalar(
        "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'native'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(native, 900000);
    let exact: i64 = sqlx::query_scalar(
        "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'import_exact'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(exact, 2700000);
    let bucket: Option<i64> = sqlx::query_scalar(
        "SELECT SUM(effective_duration_ms) FROM activity_hourly_effective WHERE origin = 'import_bucket'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(bucket, None);

    let projected = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(projected.read_path, "projection");
    assert_eq!(projected.fact_row_count, 0);
    for result in [&facts, &projected] {
        let mut by_app = BTreeMap::<&str, i64>::new();
        for record in &result.records {
            *by_app.entry(&record.exe_name).or_default() += record.end_time - record.start_time;
        }
        assert_eq!(
            by_app,
            BTreeMap::from([("exact.exe", 2_700_000), ("native.exe", 900_000),])
        );
    }
    assert_eq!(
        projected
            .records
            .iter()
            .map(|row| row.end_time - row.start_time)
            .sum::<i64>(),
        HOUR_MS
    );

    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Later', 'later.exe', ?, ?, 1000)",
    )
    .bind(HOUR_MS * 2)
    .bind(HOUR_MS * 2 + 1000)
    .execute(&pool)
    .await
    .unwrap();
    let clean_earlier_range = load_range(&pool, 0, HOUR_MS, &[]).await.unwrap();
    assert_eq!(clean_earlier_range.read_path, "projection");

    let current_ms = now_ms();
    let current_hour = floor_to_hour(current_ms);
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Active', 'active.exe', ?, NULL, NULL)",
    )
    .bind(current_ms - 1000)
    .execute(&pool)
    .await
    .unwrap();
    let active = load_range(&pool, current_hour, current_hour + HOUR_MS, &[])
        .await
        .unwrap();
    assert!(active.has_active_session);
    assert_eq!(active.read_path, "facts");
    assert!(active
        .records
        .iter()
        .any(|row| row.exe_name == "active.exe"));
}

#[tokio::test]
async fn rebuild_excludes_legacy_lifecycle_facts_using_title_metadata() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration)
         VALUES ('Alma', 'alma-0.0.750-win-x64.exe', 'Alma 安装', 0, 1800000, 1800000),
                ('Alma', 'alma.exe', 'Alma', 1800000, 3600000, 1800000)",
    )
    .execute(&pool)
    .await
    .unwrap();

    initialize_backfill(&pool).await.unwrap();
    process_backfill_batch(&pool, 0, HOUR_MS).await.unwrap();
    finish_backfill(&pool).await.unwrap();

    let rows = sqlx::query(
        "SELECT raw_exe_name, effective_duration_ms FROM activity_hourly_effective
         ORDER BY raw_exe_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].get::<String, _>("raw_exe_name"), "alma.exe");
    assert_eq!(rows[0].get::<i64, _>("effective_duration_ms"), 1800000);
}

#[tokio::test]
async fn non_hour_internal_boundaries_fall_back_to_exact_fact_geometry() {
    let pool = setup_pool().await;
    let start_ms = HOUR_MS + 40 * 60 * 1000;
    let end_ms = HOUR_MS + 50 * 60 * 1000;
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Archive', 'archive.exe', ?, ?, ?)",
    )
    .bind(start_ms)
    .bind(end_ms)
    .bind(end_ms - start_ms)
    .execute(&pool)
    .await
    .unwrap();
    initialize_backfill(&pool).await.unwrap();
    process_backfill_batch(&pool, HOUR_MS, HOUR_MS * 2)
        .await
        .unwrap();
    finish_backfill(&pool).await.unwrap();

    let boundary_ms = HOUR_MS + HOUR_MS / 2;
    let result = load_range(
        &pool,
        HOUR_MS,
        HOUR_MS * 2,
        &[HOUR_MS, boundary_ms, HOUR_MS * 2],
    )
    .await
    .unwrap();
    assert_eq!(result.read_path, "facts");
    assert_eq!(result.records.len(), 1);
    assert_eq!(result.records[0].start_time, start_ms);
    assert_eq!(result.records[0].end_time, end_ms);
}
