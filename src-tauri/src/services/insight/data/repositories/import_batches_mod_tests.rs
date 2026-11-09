//! `import_batches.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::services::insight::data::schema::{
    CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL, IMPORT_DATA_SCHEMA_SQL,
};
use sqlx::Executor;

async fn setup_pool() -> Pool<Sqlite> {
    let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
    pool.execute(CURRENT_BASELINE_SCHEMA_SQL).await.unwrap();
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(IMPORT_DATA_SCHEMA_SQL).await.unwrap();
    pool.execute(IMPORT_DATA_ISOLATION_SCHEMA_SQL)
        .await
        .unwrap();
    pool
}

fn record(record_type: ImportRecordType, start: i64) -> CanonicalImportRecord {
    CanonicalImportRecord {
        source_line: 2,
        record_type,
        start_time_ms: start,
        end_time_ms: (record_type == ImportRecordType::ExactSession).then_some(start + 1_000),
        duration_ms: 1_000,
        exe_name: "code.exe".to_string(),
        app_name: Some("Code".to_string()),
        title: (record_type == ImportRecordType::ExactSession).then(|| "Editor".to_string()),
        category: Some("Development".to_string()),
    }
}

#[test]
fn commit_is_idempotent_and_delete_only_removes_selected_batch() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let mut exact_record = record(ImportRecordType::ExactSession, 1_000);
        exact_record.title = None;
        let first_records = vec![
            exact_record.clone(),
            exact_record,
            record(ImportRecordType::HourBucket, 2_000),
        ];
        let first = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "one",
            &first_records,
            0,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(first.imported_records, 2);
        assert_eq!(first.duplicate_records, 1);
        let native_session_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(native_session_count, 0);
        let imported_title: String = sqlx::query_scalar(
            "SELECT window_title FROM import_exact_sessions WHERE exe_name = 'code.exe'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert!(imported_title.is_empty());
        let imported_source_path_count: i64 = sqlx::query_scalar(
            "SELECT
                (SELECT COUNT(*) FROM import_exact_sessions WHERE source_path IS NOT NULL) +
                (SELECT COUNT(*) FROM import_time_buckets WHERE source_path IS NOT NULL)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(imported_source_path_count, 0);
        let duplicate = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "one",
            &first_records,
            0,
            &[],
        )
        .await
        .unwrap();
        assert_eq!(duplicate.imported_records, 0);
        assert_eq!(duplicate.duplicate_records, 3);
        assert_eq!(list(&pool).await.unwrap().len(), 1);

        sqlx::query(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES ('Native', 'code.exe', 'Native editor', 1000, 2000, 1000, 1000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        let report = delete(&pool, first.batch_id.as_deref().unwrap())
            .await
            .unwrap();
        assert_eq!(report.deleted_exact_sessions, 1);
        assert_eq!(report.deleted_hour_buckets, 1);
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
                "code.exe".to_string(),
                "Native editor".to_string(),
                1_000,
                2_000,
                1_000,
            )
        );
        let exact_import_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM import_exact_sessions")
                .fetch_one(&pool)
                .await
                .unwrap();
        let bucket_import_count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM import_time_buckets")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((exact_import_count, bucket_import_count), (0, 0));
        assert!(list(&pool).await.unwrap().is_empty());
    });
}

#[test]
fn failed_delete_rolls_back_without_touching_native_data() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let error = delete(&pool, "missing").await.unwrap_err();
        assert!(error.contains("no longer exists"));
        assert!(list(&pool).await.unwrap().is_empty());
    });
}

#[test]
fn deleting_one_import_batch_preserves_other_external_batches() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let override_key = "__app_override::code.exe";
        let first = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "source-one",
            &[record(ImportRecordType::ExactSession, 1_000)],
            0,
            &[ClassificationSettingMutation {
                key: override_key.to_string(),
                value: Some(r#"{"category":"development","enabled":true}"#.to_string()),
            }],
        )
        .await
        .unwrap();
        let second = commit_records(
            &pool,
            "two.csv",
            "patina-csv",
            "source-two",
            &[record(ImportRecordType::ExactSession, 3_000)],
            0,
            &[],
        )
        .await
        .unwrap();

        delete(&pool, first.batch_id.as_deref().unwrap())
            .await
            .unwrap();

        let batches = list(&pool).await.unwrap();
        assert_eq!(batches.len(), 1);
        assert_eq!(batches[0].id, second.batch_id.unwrap());
        let remaining_starts: Vec<i64> = sqlx::query_scalar(
            "SELECT start_time FROM import_exact_sessions ORDER BY start_time",
        )
        .fetch_all(&pool)
        .await
        .unwrap();
        assert_eq!(remaining_starts, vec![3_000]);
        let native_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(native_count, 0);
        let override_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(override_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert!(override_value.is_some());
    });
}

#[test]
fn import_only_icon_is_removed_with_the_last_batch() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let first = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "one",
            &[record(ImportRecordType::ExactSession, 1000)],
            0,
            &[],
        )
        .await
        .unwrap();
        let last = commit_records(
            &pool,
            "two.csv",
            "patina-csv",
            "two",
            &[record(ImportRecordType::HourBucket, 3000)],
            0,
            &[],
        )
        .await
        .unwrap();
        pool.execute("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES ('code.exe','icon',0)").await.unwrap();
        for (batch, expected) in [(first, 1_i64), (last, 0)] {
            delete(&pool, batch.batch_id.as_deref().unwrap())
                .await
                .unwrap();
            let count: i64 = sqlx::query_scalar("SELECT count(*) FROM icon_cache")
                .fetch_one(&pool)
                .await
                .unwrap();
            assert_eq!(count, expected);
        }
    });
}

#[test]
fn deleting_the_last_external_records_keeps_configured_app_icons() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let override_key = "__app_override::code.exe";
        let category_key = "__custom_category::custom:category_focus";
        let report = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "import-only-source",
            &[record(ImportRecordType::ExactSession, 1_000)],
            0,
            &[
                ClassificationSettingMutation {
                    key: override_key.to_string(),
                    value: Some(
                        r#"{"category":"custom:category_focus","enabled":true}"#.to_string(),
                    ),
                },
                ClassificationSettingMutation {
                    key: category_key.to_string(),
                    value: Some("1".to_string()),
                },
            ],
        )
        .await
        .unwrap();

        pool.execute("INSERT INTO icon_cache(exe_name,icon_base64,last_updated) VALUES (\'code.exe\',\'icon\',0)").await.unwrap();
        delete(&pool, report.batch_id.as_deref().unwrap())
            .await
            .unwrap();

        let remaining_external_records: i64 = sqlx::query_scalar(
            "SELECT
                (SELECT COUNT(*) FROM import_exact_sessions) +
                (SELECT COUNT(*) FROM import_time_buckets)",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        let override_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(override_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        let category_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(category_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(remaining_external_records, 0);
        assert_eq!(
            override_value.as_deref(),
            Some(r#"{"category":"custom:category_focus","enabled":true}"#)
        );
        assert_eq!(
            sqlx::query_scalar::<_, i64>(
                "SELECT count(*) FROM icon_cache WHERE exe_name=\'code.exe\'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            1
        );
        assert_eq!(category_value.as_deref(), Some("1"));
    });
}

#[test]
fn deleting_external_records_preserves_the_override_for_a_native_app() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let override_key = "__app_override::code.exe";
        let report = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "mixed-source",
            &[record(ImportRecordType::ExactSession, 1_000)],
            0,
            &[ClassificationSettingMutation {
                key: override_key.to_string(),
                value: Some(r#"{"category":"development","enabled":true}"#.to_string()),
            }],
        )
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO sessions (
                app_name, exe_name, window_title, start_time, end_time, duration,
                continuity_group_start_time
             ) VALUES ('Native Code', 'code.exe', '', 3000, 4000, 1000, 3000)",
        )
        .execute(&pool)
        .await
        .unwrap();

        delete(&pool, report.batch_id.as_deref().unwrap())
            .await
            .unwrap();

        let override_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(override_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert!(override_value.is_some());
    });
}

#[test]
fn classification_validation_failure_rolls_back_the_entire_import_transaction() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let valid_key = "__custom_category::custom:category_focus";
        let result = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "atomic-source",
            &[record(ImportRecordType::ExactSession, 1_000)],
            0,
            &[
                ClassificationSettingMutation {
                    key: valid_key.to_string(),
                    value: Some("1".to_string()),
                },
                ClassificationSettingMutation {
                    key: "tracking_paused".to_string(),
                    value: Some("1".to_string()),
                },
            ],
        )
        .await;

        assert!(result.is_err());
        assert!(list(&pool).await.unwrap().is_empty());
        let exact_count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM import_exact_sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        let category_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(valid_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(exact_count, 0);
        assert_eq!(category_value, None);
    });
}

#[test]
fn deleting_an_import_batch_preserves_categories_created_during_import() {
    tauri::async_runtime::block_on(async {
        let pool = setup_pool().await;
        let category_key = "__custom_category::custom:category_focus";
        let report = commit_records(
            &pool,
            "one.csv",
            "patina-csv",
            "category-source",
            &[record(ImportRecordType::ExactSession, 1_000)],
            0,
            &[ClassificationSettingMutation {
                key: category_key.to_string(),
                value: Some("1".to_string()),
            }],
        )
        .await
        .unwrap();

        delete(&pool, report.batch_id.as_deref().unwrap())
            .await
            .unwrap();

        let category_value: Option<String> =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
                .bind(category_key)
                .fetch_optional(&pool)
                .await
                .unwrap();
        assert_eq!(category_value.as_deref(), Some("1"));
        assert!(list(&pool).await.unwrap().is_empty());
    });
}
