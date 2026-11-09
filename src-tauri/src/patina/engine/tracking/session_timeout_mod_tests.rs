//! `session_timeout.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use crate::patina::data::schema as db_schema;
use crate::patina::data::tracking_runtime::TrackingRuntimeDataStore;
use crate::patina::domain::tracking::SustainedParticipationStatusReason;
use crate::patina::engine::tracking::active_session;
use sqlx::{Executor, SqlitePool};

fn make_window(overrides: &[(&str, &str)]) -> tracker::WindowInfo {
    let mut window = tracker::WindowInfo {
        hwnd: "0x100".into(),
        root_owner_hwnd: "0x100".into(),
        process_id: 123,
        window_class: "Chrome_WidgetWin_1".into(),
        title: "Window".into(),
        exe_name: "QQ.exe".into(),
        process_path: r"C:\Program Files\QQ\QQ.exe".into(),
        app_user_model_id: String::new(),
        is_afk: false,
        idle_time_ms: 0,
    };

    for (key, value) in overrides {
        match *key {
            "hwnd" => window.hwnd = (*value).into(),
            "root_owner_hwnd" => window.root_owner_hwnd = (*value).into(),
            "process_id" => window.process_id = value.parse().unwrap(),
            "window_class" => window.window_class = (*value).into(),
            "title" => window.title = (*value).into(),
            "exe_name" => window.exe_name = (*value).into(),
            "process_path" => window.process_path = (*value).into(),
            "is_afk" => window.is_afk = *value == "true",
            "idle_time_ms" => window.idle_time_ms = value.parse().unwrap(),
            _ => {}
        }
    }

    window
}

async fn setup_test_db() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    pool.execute(db_schema::CURRENT_BASELINE_SCHEMA_SQL)
        .await
        .unwrap();
    pool
}

fn data_store(pool: &SqlitePool) -> TrackingRuntimeDataStore {
    TrackingRuntimeDataStore::new(pool.clone())
}

#[test]
fn continuity_timeout_seals_active_session_at_continuity_boundary() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let window = make_window(&[("idle_time_ms", "300000")]);

        assert!(
            active_session::start_session(&pool, &make_window(&[]), 10_000)
                .await
                .unwrap()
        );

        let data = data_store(&pool);
        let reason = seal_active_sessions_for_continuity_timeout(&data, &window, 400_000, 180)
            .await
            .unwrap();

        let ended: Option<(i64, i64)> = sqlx::query_as(
            "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert_eq!(reason, Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
        assert_eq!(ended, Some((280_000, 270_000)));
    });
}

#[test]
fn continuity_timeout_allows_same_app_to_start_new_session_after_input_returns() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let previous = make_window(&[]);
        let timed_out = make_window(&[("idle_time_ms", "240000")]);
        let resumed = make_window(&[("idle_time_ms", "1")]);

        assert!(active_session::start_session(&pool, &previous, 1_000)
            .await
            .unwrap());

        let data = data_store(&pool);
        let seal_reason =
            seal_active_sessions_for_continuity_timeout(&data, &timed_out, 300_000, 180)
                .await
                .unwrap();
        let recover_reason = transition::apply_window_transition(
            &data,
            Some(&timed_out),
            &resumed,
            301_000,
            301_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(seal_reason, Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
        assert_eq!(recover_reason, Some("session-recovered"));
        assert_eq!(
            sessions,
            vec![(1_000, 1_000, Some(240_000)), (301_000, 301_000, None)]
        );
    });
}

#[test]
fn sustained_participation_signal_skips_continuity_suspend() {
    let previous = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "0")]);
    let current = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "240000")]);
    let tracking_status = TrackingStatusSnapshot {
        is_tracking_active: true,
        sustained_participation_eligible: true,
        sustained_participation_active: true,
        sustained_participation_kind: None,
        ..TrackingStatusSnapshot::default()
    };

    assert!(!should_suspend_active_tracking(
        Some(&previous),
        &current,
        180,
        &tracking_status,
    ));
}

#[test]
fn sustained_participation_timeout_seals_session_at_sustained_boundary() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let previous = make_window(&[("exe_name", "Zoom.exe"), ("idle_time_ms", "0")]);
        let timed_out = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("idle_time_ms", "660000"),
            ("is_afk", "true"),
        ]);
        let expired_status = TrackingStatusSnapshot {
            sustained_participation_state: SustainedParticipationState::Expired,
            sustained_participation_reason:
                SustainedParticipationStatusReason::SustainedWindowExpired,
            ..TrackingStatusSnapshot::default()
        };
        let previous_status = TrackingStatusSnapshot {
            sustained_participation_active: true,
            sustained_participation_state: SustainedParticipationState::Active,
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &previous, 10_000)
            .await
            .unwrap());
        assert!(should_seal_sustained_participation(
            Some(&previous),
            Some(&previous_status),
            &timed_out,
            &expired_status,
        ));

        let data = data_store(&pool);
        let reason = seal_active_sessions_for_passive_participation_timeout(
            &data, &timed_out, 700_000, 600,
        )
        .await
        .unwrap();

        let ended: Option<(i64, i64)> = sqlx::query_as(
            "SELECT end_time, duration FROM sessions WHERE end_time IS NOT NULL LIMIT 1",
        )
        .fetch_optional(&pool)
        .await
        .unwrap();

        assert_eq!(reason, Some(TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED));
        assert_eq!(ended, Some((640_000, 630_000)));
    });
}

#[test]
fn sustained_participation_timeout_supports_unknown_audio_signal_matches() {
    let previous = make_window(&[
        ("exe_name", "PotPlayerMini64.exe"),
        (
            "process_path",
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
        ),
        ("idle_time_ms", "0"),
    ]);
    let timed_out = make_window(&[
        ("exe_name", "PotPlayerMini64.exe"),
        (
            "process_path",
            r"C:\Program Files\DAUM\PotPlayer\PotPlayerMini64.exe",
        ),
        ("idle_time_ms", "660000"),
        ("is_afk", "true"),
    ]);
    let expired_status = TrackingStatusSnapshot {
        sustained_participation_state: SustainedParticipationState::Expired,
        sustained_participation_reason:
            SustainedParticipationStatusReason::SustainedWindowExpired,
        ..TrackingStatusSnapshot::default()
    };
    let previous_status = TrackingStatusSnapshot {
        sustained_participation_active: true,
        sustained_participation_state: SustainedParticipationState::Active,
        ..TrackingStatusSnapshot::default()
    };

    assert!(should_seal_sustained_participation(
        Some(&previous),
        Some(&previous_status),
        &timed_out,
        &expired_status,
    ));
}
