//! `runtime_snapshot.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;

fn make_window() -> WindowInfo {
    WindowInfo {
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
    }
}

#[test]
fn snapshot_state_returns_latest_runtime_snapshot() {
    let state = TrackingRuntimeSnapshotState::default();
    let snapshot = TrackingRuntimeSnapshot {
        generation: 0,
        source_window: None,
        anonymous: false,
        window: make_window(),
        status: TrackingStatusSnapshot::default(),
        sampled_at_ms: 123,
        probe_status: TrackingRuntimeProbeStatus::Ok,
        degraded_reason: None,
        probe_diagnostics: TrackingRuntimeProbeDiagnostics::default(),
        active_session: None,
    };

    state.replace(snapshot.clone());

    let loaded = state.snapshot().unwrap();
    assert_eq!(loaded.sampled_at_ms, 123);
    assert_eq!(loaded.probe_status, TrackingRuntimeProbeStatus::Ok);
    assert_eq!(loaded.window.exe_name, snapshot.window.exe_name);
}

#[test]
fn old_publications_cannot_restore_activity_after_policy_or_power_changes() {
    let state = TrackingRuntimeSnapshotState::default();
    let mut snapshot = TrackingRuntimeSnapshot {
        generation: 0,
        source_window: None,
        anonymous: false,
        window: make_window(),
        status: TrackingStatusSnapshot {
            is_tracking_active: true,
            ..Default::default()
        },
        sampled_at_ms: 1_000,
        probe_status: TrackingRuntimeProbeStatus::Ok,
        degraded_reason: None,
        probe_diagnostics: Default::default(),
        active_session: Some(ActiveSessionSnapshot {
            id: 1,
            app_name: "A".into(),
            exe_name: "a.exe".into(),
            start_time: 1_000,
            continuity_group_start_time: 1_000,
            closed_duration_ms: 0,
        }),
    };
    state.replace(snapshot.clone());
    state.note_tracking_policy_change();
    state.replace(snapshot.clone());
    assert!(state.snapshot().unwrap().active_session.is_none());
    assert!(!state.snapshot().unwrap().status.is_tracking_active);
    snapshot.generation = state.lifecycle_generation();
    state.replace(snapshot.clone());
    assert!(state.snapshot().unwrap().active_session.is_some());
    state.note_power_event("lock", 5_000);
    let old_stop = state.pending_stop().unwrap();
    state.note_power_event("suspend", 6_000);
    state.acknowledge_stop(old_stop);
    assert!(
        state.pending_stop().is_some(),
        "an old handler cannot acknowledge a newer stop"
    );
    state.note_power_event("unlock", 7_000);
    let stop = state.pending_stop().unwrap();
    state.acknowledge_stop(stop);
    assert!(
        !state.accepts_sample(state.lifecycle_generation()),
        "unlock does not imply resume"
    );
    state.note_power_event("resume", 8_000);
    assert!(state.accepts_sample(state.lifecycle_generation()));
    state.replace(snapshot);
    assert!(state.snapshot().unwrap().active_session.is_none());
}
