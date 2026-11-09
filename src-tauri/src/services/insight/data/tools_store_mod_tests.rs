//! `tools_store.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::services::insight::data::schema;
use crate::models::insight::tools::ActivityReminderTarget;
use futures_util::FutureExt;
use sqlx::{Executor, SqlitePool};
use std::panic::AssertUnwindSafe;

#[tokio::test]
async fn tools_tick_skips_activity_tables_when_no_check_is_due() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for migration in schema::tracker_migrations() {
        pool.execute(migration.sql).await.unwrap();
    }
    pool.execute(
        "ALTER TABLE tool_activity_reminder_rules RENAME TO unavailable_activity_rules",
    )
    .await
    .unwrap();
    let events = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], None)
        .await
        .unwrap();
    assert!(events.activity_reminders.is_empty());
    assert_eq!(events.activity_watch.next_check_at(), None);
    assert!(!events.state_changed);
    assert!(tick_tools_with_pool(
        &pool,
        120_000,
        "2026-06-07",
        0,
        &[],
        Some(&ActivityReminderCheck::All)
    )
    .await
    .is_err());
    pool.close().await;
}

#[tokio::test]
async fn tools_tick_late_sql_failure_preserves_all_due_events_for_retry() {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    let outcome = AssertUnwindSafe(async {
        for sql in [schema::CURRENT_BASELINE_SCHEMA_SQL, schema::TOOLS_TABLES_SCHEMA_SQL, schema::POMODORO_TASKS_SQL, schema::POMODORO_COMPLETIONS_SQL, schema::FREE_FOCUS_SQL,
            schema::SOFTWARE_REMINDER_RULES_SCHEMA_SQL, schema::ACTIVITY_REMINDER_RULES_SCHEMA_SQL, schema::ACTIVITY_REMINDER_EXTENSION_SQL, schema::ACTIVITY_REMINDER_ENABLED_SQL,
        schema::REMINDER_RECURRENCE_SQL,
            schema::WEB_ACTIVITY_SCHEMA_SQL] {
            pool.execute(sql).await.unwrap();
        }
        pool.execute("INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time, duration, continuity_group_start_time)
            VALUES ('Editor', 'editor.exe', 'Doc', 0, 60000, 60000, 0);").await.unwrap();
        tools::timed_reminders::create_reminder(&pool, "Due reminder", 115_000, None, 110_000).await.unwrap();
        tools::create_activity_reminder_rule(&pool, &ActivityReminderTarget::App {
            app_name: "Editor".into(), exe_name: Some("editor.exe".into()),
        }, "Editor", 60_000, "Take a break", 110_000).await.unwrap();
        tools::start_pomodoro(&pool, 5_000, 5_000, 10_000, 4, 110_000).await.unwrap();
        pool.execute("CREATE TRIGGER reject_tick_daily_stat BEFORE INSERT ON tool_daily_stats
            BEGIN SELECT RAISE(ABORT, 'controlled late tick failure'); END;").await.unwrap();

        let error = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap_err();
        assert!(error.contains("controlled late tick failure"), "{error}");
        let persisted: (String, Option<String>, String, i64, i64) = sqlx::query_as(
            "SELECT (SELECT status FROM tool_reminders LIMIT 1),
                (SELECT last_fired_date_key FROM tool_activity_reminder_rules LIMIT 1),
                (SELECT phase FROM tool_pomodoro_runs LIMIT 1),
                (SELECT completed_focus_count FROM tool_pomodoro_runs LIMIT 1),
                (SELECT COUNT(*) FROM tool_daily_stats)").fetch_one(&pool).await.unwrap();
        assert_eq!(persisted, ("scheduled".into(), None, "focus".into(), 0, 0),
            "a failed tick must not consume notifications before their event batch exists");

        pool.execute("DROP TRIGGER reject_tick_daily_stat").await.unwrap();
        let recovered = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap();
        assert_eq!(recovered.reminders.len(), 1);
        assert_eq!(recovered.activity_reminders.len(), 1);
        assert!(recovered.completed_pomodoro.is_some());
        assert!(recovered.state_changed);
        let repeated = tick_tools_with_pool(&pool, 120_000, "2026-06-07", 0, &[], Some(&ActivityReminderCheck::All)).await.unwrap();
        assert!(repeated.reminders.is_empty());
        assert!(repeated.activity_reminders.is_empty());
        assert!(repeated.completed_pomodoro.is_none());
        assert!(!repeated.state_changed);
    }).catch_unwind().await;
    pool.close().await;
    if let Err(panic) = outcome {
        std::panic::resume_unwind(panic);
    }
}
