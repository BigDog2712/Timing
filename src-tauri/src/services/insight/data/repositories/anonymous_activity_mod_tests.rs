//! `anonymous_activity.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use sqlx::Executor;

async fn setup() -> Pool<Sqlite> {
    let pool = Pool::<Sqlite>::connect("sqlite::memory:").await.unwrap();
    pool.execute(crate::services::insight::data::schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::IMPORT_DATA_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::IMPORT_DATA_ISOLATION_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::ACTIVITY_READ_MODELS_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(crate::services::insight::data::schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
        .await
        .unwrap();
    pool.execute(SCHEMA_SQL).await.unwrap();
    pool
}

#[test]
fn anonymous_heartbeats_do_not_accumulate_projection_dirty_ranges() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        observe(&pool, 0, false).await.unwrap();
        for now in 1..100 {
            observe(&pool, now * 1000, false).await.unwrap();
        }
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 1);
        seal(&pool, 100_000).await.unwrap();
        let count: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(count, 2);
    });
}

#[test]
fn settings_stop_anonymous_activity_without_erasing_or_disabling_other_app_time() {
    tauri::async_runtime::block_on(async {
        use super::super::app_settings::{commit_app_setting_mutations, AppSettingMutation};
        let pool = setup().await;
        observe(&pool, 1000, true).await.unwrap();
        commit_app_setting_mutations(
            &pool,
            &[AppSettingMutation {
                key: "web_activity_enabled".into(),
                value: "false".into(),
            }],
        )
        .await
        .unwrap();
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM anonymous_activity WHERE end_time IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active, 0);
        observe(&pool, 2000, false).await.unwrap();
        commit_app_setting_mutations(
            &pool,
            &[AppSettingMutation {
                key: "web_activity_enabled".into(),
                value: "false".into(),
            }],
        )
        .await
        .unwrap();
        let active: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM anonymous_activity WHERE end_time IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            active, 1,
            "web settings do not stop native anonymous app activity"
        );
        commit_app_setting_mutations(
            &pool,
            &[AppSettingMutation {
                key: "tracking_paused".into(),
                value: "true".into(),
            }],
        )
        .await
        .unwrap();
        let counts: (i64, i64) =
            sqlx::query_as("SELECT COUNT(*), SUM(end_time IS NULL) FROM anonymous_activity")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(counts, (2, 0));
    });
}

#[test]
fn anonymous_backup_merge_is_idempotent_and_keeps_current_conflicts() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        observe(&pool, 1_000, true).await.unwrap();
        seal(&pool, 5_000).await.unwrap();
        let mut saved = read_range(&pool, 0, 10_000).await.unwrap();
        saved[0].end_time = Some(9_000);
        for _ in 0..2 {
            let mut tx = pool.begin().await.unwrap();
            merge_for_restore(&mut tx, &saved).await.unwrap();
            tx.commit().await.unwrap();
        }
        let rows = read_range(&pool, 0, 10_000).await.unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].end_time, Some(5_000));
        let mut second = saved[0].clone();
        second.id = uuid::Uuid::new_v4().to_string();
        let mut tx = pool.begin().await.unwrap();
        merge_for_restore(&mut tx, &[second]).await.unwrap();
        tx.rollback().await.unwrap();
        assert_eq!(read_range(&pool, 0, 10_000).await.unwrap().len(), 1);
    });
}

#[test]
fn failed_anonymous_projection_signal_rolls_back_the_named_boundary() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        super::super::sessions::start_session(&pool, "Editor", "editor.exe", "Public", 0, 0)
            .await
            .unwrap();
        pool.execute("CREATE TRIGGER reject_anonymous_dirty BEFORE INSERT ON activity_summary_dirty_ranges
            WHEN NEW.reason='native_insert' BEGIN SELECT RAISE(ABORT, 'fixture'); END").await.unwrap();
        assert!(observe(&pool, 1_000, false).await.is_err());
        let end: Option<i64> = sqlx::query_scalar("SELECT end_time FROM sessions LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(end, None);
        let count: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM anonymous_activity")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(count, 0);
    });
}

#[test]
fn anonymous_sources_share_one_interval_without_retaining_identity() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        assert!(observe(&pool, 1_000, false).await.unwrap());
        assert!(!observe(&pool, 5_000, false).await.unwrap());
        assert!(!observe(&pool, 4_000, false).await.unwrap());
        seal(&pool, 10_000).await.unwrap();
        let records = read_range(&pool, 0, 20_000).await.unwrap();
        assert_eq!(records.len(), 1);
        assert_eq!(records[0].end_time, Some(10_000));
        assert_eq!(records[0].start_time, 1_000);
    });
}

#[test]
fn web_subset_and_idle_boundaries_preserve_total_time() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        observe(&pool, 0, false).await.unwrap();
        observe(&pool, 5_000, true).await.unwrap();
        observe(&pool, 8_000, true).await.unwrap();
        seal(&pool, 10_000).await.unwrap();
        observe(&pool, 20_000, false).await.unwrap();
        observe(&pool, 25_000, false).await.unwrap();
        seal_interrupted(&pool, 30_000).await.unwrap();
        let rows = read_range(&pool, 0, 40_000).await.unwrap();
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows.iter()
                .map(|row| row.end_time.unwrap() - row.start_time)
                .sum::<i64>(),
            15_000
        );
        assert_eq!(
            rows.iter()
                .filter(|row| row.is_web)
                .map(|row| row.end_time.unwrap() - row.start_time)
                .sum::<i64>(),
            5_000
        );
        assert_eq!(rows[2].end_time, Some(25_000));
    });
}

#[test]
fn anonymous_range_uses_its_effective_end_index() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        let plan: Vec<(i64, i64, i64, String)> =
            sqlx::query_as(&format!("EXPLAIN QUERY PLAN {RANGE_SQL}"))
                .bind(20_000)
                .bind(10_000)
                .fetch_all(&pool)
                .await
                .unwrap();
        assert!(
            plan.iter().any(|row| row.3.contains(
                "SEARCH anonymous_activity USING INDEX idx_anonymous_activity_range"
            )),
            "{plan:?}"
        );
        assert!(
            !plan
                .iter()
                .any(|row| row.3.contains("SCAN anonymous_activity")),
            "{plan:?}"
        );
    });
}

#[test]
fn retroactive_idle_cutoff_never_creates_a_negative_interval() {
    tauri::async_runtime::block_on(async {
        let pool = setup().await;
        observe(&pool, 1_000, false).await.unwrap();
        seal(&pool, 0).await.unwrap();
        assert!(read_range(&pool, 0, 10_000).await.unwrap().is_empty());
    });
}
