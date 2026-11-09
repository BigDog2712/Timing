//! `session_title_samples.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::services::insight::data::schema as db_schema;
use sqlx::{Executor, SqlitePool};

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(
        "INSERT INTO sessions (id, app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
         VALUES (1, 'Editor', 'editor.exe', 'Doc A', 1000, NULL, NULL, 1000)",
    )
    .await
    .unwrap();
    pool
}

#[test]
fn new_title_sample_is_inserted_for_non_empty_title() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;

        assert!(start_title_sample(&pool, 1, " Doc A ", 900).await.unwrap());

        let row: (String, i64) = sqlx::query_as(
            "SELECT title, start_time FROM session_title_samples WHERE session_id = 1",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(row, ("Doc A".to_string(), 1000));
    });
}

#[test]
fn unchanged_title_does_not_insert_duplicate_sample() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

        assert!(!replace_active_title_sample(&pool, 1, "Doc A", 2000)
            .await
            .unwrap());

        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 1);
    });
}

#[test]
fn changed_title_closes_previous_sample_and_starts_next() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

        assert!(replace_active_title_sample(&pool, 1, "Doc B", 2000)
            .await
            .unwrap());

        let rows: Vec<(String, i64, Option<i64>)> = sqlx::query_as(
            "SELECT title, start_time, end_time
             FROM session_title_samples
             ORDER BY id ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            rows,
            vec![
                ("Doc A".to_string(), 1000, Some(2000)),
                ("Doc B".to_string(), 2000, None),
            ]
        );
    });
}

#[test]
fn session_end_closes_last_active_sample() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        start_title_sample(&pool, 1, "Doc A", 1000).await.unwrap();

        assert!(finish_active_title_sample(&pool, 1, 5000).await.unwrap());

        let end_time: Option<i64> =
            sqlx::query_scalar("SELECT end_time FROM session_title_samples WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(end_time, Some(5000));
    });
}

#[test]
fn malicious_title_is_stored_as_data() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let title = "'; DROP TABLE session_title_samples; --";

        start_title_sample(&pool, 1, title, 1000).await.unwrap();

        let stored: String =
            sqlx::query_scalar("SELECT title FROM session_title_samples WHERE id = 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM session_title_samples")
            .fetch_one(&pool)
            .await
            .unwrap();

        assert_eq!(stored, title);
        assert_eq!(count, 1);
    });
}
