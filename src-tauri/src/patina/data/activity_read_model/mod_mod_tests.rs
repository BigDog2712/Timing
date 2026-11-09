//! `mod.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::patina::domain::activity_read_model::HOUR_MS;

#[tokio::test]
async fn idle_statistics_follow_empty_install_and_growth_without_invalidating_read_models() {
    use sqlx::Executor;
    let pool = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::patina::data::sqlite_pool::prepare_pool_schema(
        &pool,
        std::path::Path::new("statistics-lifecycle.db"),
    )
    .await
    .unwrap();
    let empty_samples: i64 = sqlx::query_scalar(
        "SELECT COUNT(*) FROM sqlite_stat4 WHERE idx='idx_sessions_end_start'",
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(empty_samples, 0);
    let mut schedule = MaintenanceSchedule::default();
    for (offset, count) in [(0, 1000), (1000, 20000)] {
        sqlx::query(
            "WITH RECURSIVE n(i) AS (VALUES(0) UNION ALL SELECT i+1 FROM n WHERE i+1<?)
            INSERT INTO sessions(app_name,exe_name,start_time,end_time,duration)
            SELECT 'Editor','editor.exe',(i+?)*1000,(i+?)*1000+500,500 FROM n",
        )
        .bind(count)
        .bind(offset)
        .bind(offset)
        .execute(&pool)
        .await
        .unwrap();
        let mut idle = false;
        for _ in 0..1000 {
            if !schedule.tick(&pool).await.unwrap() {
                idle = true;
                break;
            }
        }
        assert!(idle);
        for index in ["idx_sessions_date", "idx_sessions_end_start"] {
            let samples: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_stat4 WHERE idx=?")
                    .bind(index)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert!(
                samples > 0,
                "missing histogram after {count} rows for {index}"
            );
        }
        let stat: String = sqlx::query_scalar(
            "SELECT stat FROM sqlite_stat1 WHERE idx='idx_sessions_end_start'",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(
            stat.split_whitespace()
                .next()
                .unwrap()
                .parse::<i64>()
                .unwrap(),
            offset + count
        );
    }
    let changes: i64 = sqlx::query_scalar("SELECT total_changes()")
        .fetch_one(&pool)
        .await
        .unwrap();
    crate::patina::data::repositories::scheduled_backup::load_config(&pool)
        .await
        .unwrap();
    crate::patina::data::repositories::scheduled_export::load_config(&pool)
        .await
        .unwrap();
    for _ in 0..3 {
        let debug_sql = format!(
            "PRAGMA optimize({})",
            crate::patina::data::sqlite_pool::QUERY_STATISTICS_OPTIMIZE_MASK | 1
        );
        let pending: Vec<String> = sqlx::query_scalar(&debug_sql)
            .fetch_all(&pool)
            .await
            .unwrap();
        assert!(
            pending.is_empty(),
            "unchanged closed history must not request repeated ANALYZE: {pending:?}"
        );
        let due = schedule.next_statistics;
        assert!(!schedule.tick(&pool).await.unwrap());
        assert_eq!(schedule.next_statistics, due);
    }
    assert!(!maintain_once(&pool).await.unwrap());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT total_changes()")
            .fetch_one(&pool)
            .await
            .unwrap(),
        changes
    );
    let before: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT model_name,state,last_error_code FROM read_model_state ORDER BY model_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    pool.execute("DELETE FROM sqlite_stat1; DELETE FROM sqlite_stat4; ANALYZE sqlite_schema; PRAGMA query_only=ON").await.unwrap();
    assert!(optimize_query_statistics(&pool)
        .await
        .unwrap_err()
        .contains("readonly"));
    schedule.pending_statistics = true;
    assert!(
        !schedule.tick(&pool).await.unwrap(),
        "optimization failure is not a read-model failure"
    );
    assert!(schedule.retry_after.is_some());
    let after: Vec<(String, String, Option<String>)> = sqlx::query_as(
        "SELECT model_name,state,last_error_code FROM read_model_state ORDER BY model_name",
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(after, before);
    pool.close().await;

    let replacement = sqlx::sqlite::SqlitePoolOptions::new()
        .max_connections(1)
        .connect("sqlite::memory:")
        .await
        .unwrap();
    crate::patina::data::sqlite_pool::prepare_pool_schema(
        &replacement,
        std::path::Path::new("replacement.db"),
    )
    .await
    .unwrap();
    for _ in 0..20 {
        if !schedule.tick(&replacement).await.unwrap() {
            break;
        }
    }
    assert!(
        schedule.next_statistics.is_some() && schedule.retry_after.is_none(),
        "a replaced pool must run its own statistics maintenance immediately"
    );
    replacement.close().await;
}

#[test]
fn page_shaped_boundaries_reduce_records_without_changing_duration() {
    let records = vec![
        ActivityAggregateRecordDto {
            app_name: "Code".into(),
            anonymous: false,
            exe_name: "code.exe".into(),
            start_time: 0,
            end_time: 10,
        },
        ActivityAggregateRecordDto {
            app_name: "Code".into(),
            anonymous: false,
            exe_name: "code.exe".into(),
            start_time: 20,
            end_time: 40,
        },
    ];
    let result = aggregate_records_into_boundaries(records, 0, 100, &[0, 50, 100]).unwrap();
    assert_eq!(result.len(), 1);
    assert_eq!(result[0].end_time - result[0].start_time, 30);
}

#[test]
fn page_shaped_boundaries_preserve_overlapping_duration_without_crossing_the_bucket() {
    let records = vec![
        ActivityAggregateRecordDto {
            app_name: "App".into(),
            anonymous: false,
            exe_name: "app.exe".into(),
            start_time: 0,
            end_time: HOUR_MS,
        },
        ActivityAggregateRecordDto {
            app_name: "App".into(),
            anonymous: false,
            exe_name: "app.exe".into(),
            start_time: 0,
            end_time: HOUR_MS,
        },
    ];
    let shaped = aggregate_records_into_boundaries(records, 0, HOUR_MS, &[0, HOUR_MS]).unwrap();
    assert_eq!(shaped.len(), 2);
    assert!(shaped.iter().all(|record| record.end_time <= HOUR_MS));
    assert_eq!(
        shaped
            .iter()
            .map(|record| record.end_time - record.start_time)
            .sum::<i64>(),
        HOUR_MS * 2
    );
}

#[test]
fn invalid_page_boundaries_fail_closed() {
    assert!(aggregate_records_into_boundaries(Vec::new(), 0, 10, &[0, 5, 5, 10]).is_err());
}

#[test]
fn page_shaping_clips_straddling_records_and_ignores_outside_or_empty_intervals() {
    let records =
        [(-20, 100), (10, 50), (100, 120), (40, 40), (60, 20)].map(|(start_time, end_time)| {
            ActivityAggregateRecordDto {
                app_name: "Editor".into(),
                anonymous: false,
                exe_name: "editor.exe".into(),
                start_time,
                end_time,
            }
        });
    let result =
        aggregate_records_into_boundaries(records.into(), 0, 100, &[0, 10, 50, 100]).unwrap();
    let mut buckets = BTreeMap::<i64, i64>::new();
    for record in result {
        *buckets.entry(record.start_time).or_default() += record.end_time - record.start_time;
    }
    assert_eq!(
        buckets.into_iter().collect::<Vec<_>>(),
        [(0, 10), (10, 80), (50, 50)]
    );
}
