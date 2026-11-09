//! `classification_service.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::patina::data::repositories::{sessions, web_activity};
use crate::patina::data::schema as db_schema;
use sqlx::{Executor, SqlitePool};

#[test]
fn commit_outcome_uses_final_app_and_domain_values() {
    let outcome = build_commit_outcome(&[
        ClassificationSettingMutation {
            key: "__app_override::QQ.exe".into(),
            value: Some(r#"{"track":false}"#.into()),
        },
        ClassificationSettingMutation {
            key: "__app_override::qq.exe".into(),
            value: Some(r#"{"track":true}"#.into()),
        },
        ClassificationSettingMutation {
            key: "__web_domain_override::GitHub.COM.".into(),
            value: Some(r#"{"enabled":false}"#.into()),
        },
    ]);

    assert_eq!(
        outcome.app_recording_changes,
        vec![AppRecordingPolicyChange {
            exe_name: "qq.exe".into(),
            enabled: true
        }]
    );
    assert_eq!(
        outcome.web_domain_recording_changes,
        vec![WebDomainRecordingPolicyChange {
            normalized_domain: "github.com".into(),
            enabled: false,
        }]
    );
    assert!(outcome.app_title_changes[0].enabled);
    assert!(outcome.web_domain_title_changes[0].enabled);
}

#[test]
fn title_policy_apply_closes_titles_without_closing_app_session() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
            .await
            .unwrap();
        sessions::start_session(&pool, "Chrome", "chrome.exe", "Chat", 1_000, 1_000)
            .await
            .unwrap();
        web_activity::upsert_active_segment(
            &pool,
            &crate::patina::domain::web_activity::WebActivitySegmentInput {
                native_session_id: 1,
                browser_client_id: "client".into(),
                browser_kind: "chrome".into(),
                browser_exe_name: "chrome.exe".into(),
                domain: "github.com".into(),
                normalized_domain: "github.com".into(),
                url: None,
                title: Some("Issue".into()),
                favicon_url: None,
            },
            1_000,
        )
        .await
        .unwrap();

        let outcome = ClassificationCommitOutcome {
            app_title_changes: vec![TitleRecordingPolicyChange {
                identity: "chrome.exe".into(),
                enabled: false,
            }],
            web_domain_title_changes: vec![TitleRecordingPolicyChange {
                identity: "github.com".into(),
                enabled: false,
            }],
            ..ClassificationCommitOutcome::default()
        };
        let applied = apply_recording_policy_changes_in_pool(&pool, &outcome, 2_000)
            .await
            .unwrap();
        assert!(applied.app_sealed);
        assert!(applied.web_sealed);
        let row: (String, Option<i64>) =
            sqlx::query_as("SELECT window_title, end_time FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(row, (String::new(), None));
        let web_end: Option<i64> =
            sqlx::query_scalar("SELECT end_time FROM web_activity_segments LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(web_end, Some(2_000));
    });
}

#[test]
fn policy_apply_seals_matching_app_and_web_activity_together() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_ACTIVITY_SESSION_SCHEMA_SQL)
            .await
            .unwrap();
        pool.execute(db_schema::WEB_FAVICON_CACHE_SCHEMA_SQL)
            .await
            .unwrap();
        sessions::start_session(&pool, "Chrome", "chrome.exe", "Chat", 1_000, 1_000)
            .await
            .unwrap();
        web_activity::upsert_active_segment(
            &pool,
            &crate::patina::domain::web_activity::WebActivitySegmentInput {
                native_session_id: 1,
                browser_client_id: "client".into(),
                browser_kind: "chrome".into(),
                browser_exe_name: "chrome.exe".into(),
                domain: "github.com".into(),
                normalized_domain: "github.com".into(),
                url: None,
                title: Some("Issue".into()),
                favicon_url: None,
            },
            1_000,
        )
        .await
        .unwrap();

        let applied = apply_recording_policy_changes_in_pool(
            &pool,
            &ClassificationCommitOutcome {
                app_recording_changes: vec![AppRecordingPolicyChange {
                    exe_name: "chrome.exe".into(),
                    enabled: false,
                }],
                web_domain_recording_changes: vec![WebDomainRecordingPolicyChange {
                    normalized_domain: "github.com".into(),
                    enabled: false,
                }],
                ..ClassificationCommitOutcome::default()
            },
            3_000,
        )
        .await
        .unwrap();

        assert_eq!(
            applied,
            RecordingPolicyApplyOutcome {
                app_sealed: true,
                web_sealed: false,
            }
        );
        let active_sessions: i64 =
            sqlx::query_scalar("SELECT COUNT(*) FROM sessions WHERE end_time IS NULL")
                .fetch_one(&pool)
                .await
                .unwrap();
        let active_web: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM web_activity_segments WHERE end_time IS NULL",
        )
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(active_sessions, 0);
        assert_eq!(active_web, 0);
    });
}

#[test]
fn policy_apply_immediately_seals_active_canonical_alias() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
            .await
            .unwrap();
        sessions::start_session(
            &pool,
            "Alma",
            "alma-0.0.750-win-x64.exe",
            "Alma",
            1_000,
            1_000,
        )
        .await
        .unwrap();

        let title_applied = apply_recording_policy_changes_in_pool(
            &pool,
            &ClassificationCommitOutcome {
                app_title_changes: vec![TitleRecordingPolicyChange {
                    identity: "alma.exe".into(),
                    enabled: false,
                }],
                ..ClassificationCommitOutcome::default()
            },
            1_500,
        )
        .await
        .unwrap();

        assert!(title_applied.app_sealed);
        let title_row: (String, Option<i64>) =
            sqlx::query_as("SELECT window_title, end_time FROM sessions LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title_row, (String::new(), None));
        let title_sample_end: Option<i64> =
            sqlx::query_scalar("SELECT end_time FROM session_title_samples LIMIT 1")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(title_sample_end, Some(1_500));

        let tracking_applied = apply_recording_policy_changes_in_pool(
            &pool,
            &ClassificationCommitOutcome {
                app_recording_changes: vec![AppRecordingPolicyChange {
                    exe_name: "alma.exe".into(),
                    enabled: false,
                }],
                ..ClassificationCommitOutcome::default()
            },
            2_000,
        )
        .await
        .unwrap();

        assert!(tracking_applied.app_sealed);
        let end_time: Option<i64> = sqlx::query_scalar("SELECT end_time FROM sessions LIMIT 1")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(end_time, Some(2_000));
    });
}
