//! `continuity.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::{
    load_pending_continuity, resolve_next_pending_continuity,
    resolve_next_session_continuity_group_start_time,
};
use crate::services::insight::data::schema as db_schema;
use crate::services::insight::data::tracking_runtime::TrackingRuntimeDataStore;
use crate::models::insight::tracking::{SustainedParticipationKind, TrackingStatusSnapshot};
use crate::services::insight::engine::tracking::{active_session, transition};
use crate::infra::insight::windows::foreground as tracker;
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
fn sustained_participation_short_app_switch_reuses_original_continuity_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let video = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_video = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: true,
            sustained_participation_active: true,
            sustained_participation_kind: Some(SustainedParticipationKind::Audio),
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &video, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&video),
            Some(&previous_status),
            &chat,
            180,
            10_000,
        )
        .await
        .unwrap();

        let switch_reason = transition::apply_window_transition(
            &data,
            Some(&video),
            &chat,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let return_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(
                Some(&pending),
                &resumed_video,
                70_000,
            );
        let return_reason = transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_video,
            70_000,
            return_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(switch_reason, Some("session-transition"));
        assert_eq!(return_reason, Some("session-transition"));
        assert_eq!(
            sessions,
            vec![
                ("Zoom.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 10_000, 10_000, Some(70_000)),
                ("Zoom.exe".into(), 70_000, 1_000, None),
            ]
        );
    });
}

#[test]
fn sustained_participation_return_after_continuity_window_starts_new_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let video = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_video = make_window(&[
            ("exe_name", "Zoom.exe"),
            ("process_path", r"C:\Program Files\Zoom\Zoom.exe"),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: true,
            sustained_participation_active: true,
            sustained_participation_kind: Some(SustainedParticipationKind::Audio),
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &video, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&video),
            Some(&previous_status),
            &chat,
            180,
            10_000,
        )
        .await
        .unwrap();

        let switch_reason = transition::apply_window_transition(
            &data,
            Some(&video),
            &chat,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let return_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(
                Some(&pending),
                &resumed_video,
                250_000,
            );
        let return_reason = transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_video,
            250_000,
            return_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(switch_reason, Some("session-transition"));
        assert_eq!(return_reason, Some("session-transition"));
        assert_eq!(
            sessions,
            vec![
                ("Zoom.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 10_000, 10_000, Some(250_000)),
                ("Zoom.exe".into(), 250_000, 250_000, None),
            ]
        );
    });
}

#[test]
fn ordinary_short_app_switch_reuses_original_continuity_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: false,
            sustained_participation_active: false,
            sustained_participation_kind: None,
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &coding, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&coding),
            Some(&previous_status),
            &chat,
            180,
            10_000,
        )
        .await
        .unwrap();

        transition::apply_window_transition(
            &data,
            Some(&coding),
            &chat,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let return_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(
                Some(&pending),
                &resumed_coding,
                70_000,
            );
        transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_coding,
            70_000,
            return_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            sessions,
            vec![
                ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 10_000, 10_000, Some(70_000)),
                ("Code.exe".into(), 70_000, 1_000, None),
            ]
        );
    });
}

#[test]
fn ordinary_return_after_continuity_window_starts_new_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: false,
            sustained_participation_active: false,
            sustained_participation_kind: None,
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &coding, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&coding),
            Some(&previous_status),
            &chat,
            180,
            10_000,
        )
        .await
        .unwrap();

        transition::apply_window_transition(
            &data,
            Some(&coding),
            &chat,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let return_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(
                Some(&pending),
                &resumed_coding,
                250_000,
            );
        transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_coding,
            250_000,
            return_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            sessions,
            vec![
                ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 10_000, 10_000, Some(250_000)),
                ("Code.exe".into(), 250_000, 250_000, None),
            ]
        );
    });
}

#[test]
fn mixed_trackable_and_non_trackable_short_switch_reuses_original_continuity_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
        ]);
        let widget = make_window(&[
            ("exe_name", "SearchHost.exe"),
            ("process_path", r"C:\Windows\SystemApps\SearchHost.exe"),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: false,
            sustained_participation_active: false,
            sustained_participation_kind: None,
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &coding, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&coding),
            Some(&previous_status),
            &widget,
            180,
            10_000,
        )
        .await
        .unwrap();

        transition::apply_window_transition(
            &data,
            Some(&coding),
            &widget,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let chat_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(Some(&pending), &chat, 40_000);
        transition::apply_window_transition(
            &data,
            Some(&widget),
            &chat,
            40_000,
            chat_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let pending_after_chat = resolve_next_pending_continuity(
            Some(pending),
            None,
            chat_continuity_group_start_time,
            &chat,
            40_000,
        )
        .unwrap();

        let continuity_group_start_time = resolve_next_session_continuity_group_start_time(
            Some(&pending_after_chat),
            &resumed_coding,
            70_000,
        );
        transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_coding,
            70_000,
            continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            sessions,
            vec![
                ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 40_000, 40_000, Some(70_000)),
                ("Code.exe".into(), 70_000, 1_000, None),
            ]
        );
    });
}

#[test]
fn mixed_trackable_and_non_trackable_return_after_total_window_starts_new_group() {
    tauri::async_runtime::block_on(async {
        let pool = setup_test_db().await;
        let data = data_store(&pool);
        let coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
        ]);
        let widget = make_window(&[
            ("exe_name", "SearchHost.exe"),
            ("process_path", r"C:\Windows\SystemApps\SearchHost.exe"),
        ]);
        let chat = make_window(&[
            ("exe_name", "QQ.exe"),
            ("process_path", r"C:\Program Files\QQ\QQ.exe"),
        ]);
        let resumed_coding = make_window(&[
            ("exe_name", "Code.exe"),
            (
                "process_path",
                r"C:\Program Files\Microsoft VS Code\Code.exe",
            ),
            ("idle_time_ms", "1"),
        ]);
        let previous_status = TrackingStatusSnapshot {
            is_tracking_active: true,
            sustained_participation_eligible: false,
            sustained_participation_active: false,
            sustained_participation_kind: None,
            ..TrackingStatusSnapshot::default()
        };

        assert!(active_session::start_session(&pool, &coding, 1_000)
            .await
            .unwrap());

        let pending = load_pending_continuity(
            &data,
            Some(&coding),
            Some(&previous_status),
            &widget,
            180,
            10_000,
        )
        .await
        .unwrap();

        transition::apply_window_transition(
            &data,
            Some(&coding),
            &widget,
            10_000,
            10_000,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let chat_continuity_group_start_time =
            resolve_next_session_continuity_group_start_time(Some(&pending), &chat, 100_000);
        transition::apply_window_transition(
            &data,
            Some(&widget),
            &chat,
            100_000,
            chat_continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let pending_after_chat = resolve_next_pending_continuity(
            Some(pending),
            None,
            chat_continuity_group_start_time,
            &chat,
            100_000,
        )
        .unwrap();

        let continuity_group_start_time = resolve_next_session_continuity_group_start_time(
            Some(&pending_after_chat),
            &resumed_coding,
            220_000,
        );
        transition::apply_window_transition(
            &data,
            Some(&chat),
            &resumed_coding,
            220_000,
            continuity_group_start_time,
            active_session::start_session_for_transition,
        )
        .await
        .unwrap();

        let sessions: Vec<(String, i64, i64, Option<i64>)> = sqlx::query_as(
            "SELECT exe_name, start_time, continuity_group_start_time, end_time
             FROM sessions
             ORDER BY start_time ASC",
        )
        .fetch_all(&pool)
        .await
        .unwrap();

        assert_eq!(
            sessions,
            vec![
                ("Code.exe".into(), 1_000, 1_000, Some(10_000)),
                ("QQ.exe".into(), 100_000, 100_000, Some(220_000)),
                ("Code.exe".into(), 220_000, 220_000, None),
            ]
        );
    });
}
