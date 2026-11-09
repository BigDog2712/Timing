//! `window_polling.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::thread;

// Blocking sleeps below are the simulated foreground probes: they must
// outlive the configured timeout to exercise fallback behavior. Test
// coordination itself waits on observable probe state rather than sleeps.
async fn wait_for_probe_state(
    state: &ForegroundProbeState,
    predicate: impl Fn(&ForegroundProbeInner) -> bool,
) {
    tokio::time::timeout(Duration::from_secs(1), async {
        loop {
            if predicate(&lock_inner(state)) {
                return;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .expect("timed out waiting for foreground probe state");
}

fn make_window(exe_name: &str) -> tracker::WindowInfo {
    tracker::WindowInfo {
        hwnd: "0x100".into(),
        root_owner_hwnd: "0x100".into(),
        process_id: 123,
        window_class: "Chrome_WidgetWin_1".into(),
        title: "Window".into(),
        exe_name: exe_name.into(),
        process_path: format!(r"C:\Program Files\{exe_name}"),
        app_user_model_id: String::new(),
        is_afk: false,
        idle_time_ms: 0,
    }
}

#[test]
fn poll_returns_cached_window_when_probe_times_out() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());
        remember_successful_window(&state, 0, &make_window("Code.exe"), 500);

        let outcome =
            poll_active_window_with_state(state, Duration::from_millis(10), 1_000, || {
                thread::sleep(Duration::from_millis(80));
                make_window("Late.exe")
            })
            .await;

        assert_eq!(outcome.window.exe_name, "Code.exe");
        assert_eq!(
            outcome.probe_status,
            TrackingRuntimeProbeStatus::TimeoutFallback
        );
        assert_eq!(
            outcome.probe_diagnostics.fallback_started_at_ms,
            Some(1_000)
        );
        assert_eq!(outcome.probe_diagnostics.consecutive_fallback_count, 1);
        assert!(!outcome.is_successful_sample());
    });
}

#[test]
fn poll_returns_inactive_window_when_probe_times_out_without_cache() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());

        let outcome =
            poll_active_window_with_state(state, Duration::from_millis(10), 1_000, || {
                thread::sleep(Duration::from_millis(80));
                make_window("Late.exe")
            })
            .await;

        assert_eq!(outcome.window.exe_name, "");
        assert_eq!(
            outcome.probe_status,
            TrackingRuntimeProbeStatus::TimeoutInactive
        );
        assert!(!outcome.is_successful_sample());
    });
}

#[test]
fn concurrent_polls_reuse_single_in_flight_probe() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());
        remember_successful_window(&state, 0, &make_window("Code.exe"), 500);
        let calls = Arc::new(AtomicUsize::new(0));
        let first_calls = calls.clone();
        let first_state = state.clone();

        let first = tauri::async_runtime::spawn(async move {
            poll_active_window_with_state(
                first_state,
                Duration::from_millis(30),
                1_000,
                move || {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(120));
                    make_window("Late.exe")
                },
            )
            .await
        });

        wait_for_probe_state(&state, |inner| inner.active_generation.is_some()).await;
        for _ in 0..10 {
            let outcome = poll_active_window_with_state(
                state.clone(),
                Duration::from_millis(30),
                1_010,
                || make_window("ShouldNotRun.exe"),
            )
            .await;
            assert_eq!(
                outcome.probe_status,
                TrackingRuntimeProbeStatus::BackingOffFallback
            );
        }

        let first_outcome = first.await.unwrap();
        assert_eq!(
            first_outcome.probe_status,
            TrackingRuntimeProbeStatus::TimeoutFallback
        );
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    });
}

#[test]
fn native_failure_never_counts_as_a_successful_observation() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());
        let first =
            poll_active_window_with_state(state.clone(), Duration::from_secs(1), 1_000, || {
                make_window("A.exe")
            })
            .await;
        assert!(first.is_successful_sample());
        let failed = poll_active_window_result_with_state(
            state.clone(),
            Duration::from_secs(1),
            2_000,
            || Err("probe deadline exceeded".into()),
        )
        .await;
        assert!(!failed.is_successful_sample());
        assert_eq!(
            failed.probe_diagnostics.last_successful_sample_at_ms,
            Some(1_000)
        );
        assert_eq!(
            lock_inner(&state)
                .last_successful_window
                .as_ref()
                .unwrap()
                .exe_name,
            "A.exe"
        );
        assert!(lock_inner(&state).active_generation.is_none());
        let recovered =
            poll_active_window_with_state(state, Duration::from_secs(1), 3_000, || {
                make_window("B.exe")
            })
            .await;
        assert!(recovered.is_successful_sample());
        assert_eq!(recovered.window.exe_name, "B.exe");
    });
}

#[test]
fn successful_probe_updates_cache() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());

        let outcome = poll_active_window_with_state(
            state.clone(),
            Duration::from_millis(50),
            1_000,
            || make_window("Code.exe"),
        )
        .await;

        assert_eq!(outcome.probe_status, TrackingRuntimeProbeStatus::Ok);
        assert!(outcome.is_successful_sample());
        assert_eq!(
            lock_inner(&state)
                .last_successful_window
                .as_ref()
                .unwrap()
                .exe_name,
            "Code.exe"
        );
        assert_eq!(
            outcome.probe_diagnostics.last_successful_sample_at_ms,
            Some(1_000)
        );
    });
}

#[test]
fn long_running_probe_gets_bounded_recovery_attempt() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());
        let calls = Arc::new(AtomicUsize::new(0));
        let first_calls = calls.clone();
        let first_state = state.clone();

        let first = tauri::async_runtime::spawn(async move {
            poll_active_window_with_state(
                first_state,
                Duration::from_millis(10),
                1_000,
                move || {
                    first_calls.fetch_add(1, Ordering::SeqCst);
                    thread::sleep(Duration::from_millis(180));
                    make_window("Late.exe")
                },
            )
            .await
        });

        wait_for_probe_state(&state, |inner| {
            inner.fallback_started_at_ms == Some(1_000) && inner.active_generation.is_some()
        })
        .await;
        let recovery_calls = calls.clone();
        let recovered = poll_active_window_with_state(
            state.clone(),
            Duration::from_millis(50),
            12_000,
            move || {
                recovery_calls.fetch_add(1, Ordering::SeqCst);
                make_window("Code.exe")
            },
        )
        .await;

        assert_eq!(recovered.probe_status, TrackingRuntimeProbeStatus::Ok);
        assert_eq!(recovered.window.exe_name, "Code.exe");
        assert_eq!(recovered.probe_diagnostics.recovery_attempt_count, 1);
        assert_eq!(
            recovered.probe_diagnostics.last_recovery_attempt_at_ms,
            Some(12_000)
        );

        let first_outcome = first.await.unwrap();
        assert_eq!(
            first_outcome.probe_status,
            TrackingRuntimeProbeStatus::TimeoutInactive
        );
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    });
}

#[test]
fn repeated_stuck_probes_enter_hard_degraded_without_unbounded_tasks() {
    tauri::async_runtime::block_on(async {
        let state = Arc::new(ForegroundProbeState::default());
        remember_successful_window(&state, 0, &make_window("Code.exe"), 1_000);
        {
            let mut guard = lock_inner(&state);
            guard.current_generation = 1;
            guard.active_generation = Some(1);
            guard.detached_probe_count = 1;
            guard.fallback_started_at_ms = Some(2_000);
            guard.fallback_count = 2;
            guard.consecutive_fallback_count = 2;
            guard.recovery_attempt_count = 1;
            guard.last_recovery_attempt_at_ms = Some(13_000);
        }

        let third = poll_active_window_with_state(
            state.clone(),
            Duration::from_millis(10),
            43_000,
            || {
                thread::sleep(Duration::from_millis(80));
                make_window("Late2.exe")
            },
        )
        .await;
        assert_eq!(
            third.probe_status,
            TrackingRuntimeProbeStatus::RecoveryAttemptedFallback
        );
        let hard_degraded =
            poll_active_window_with_state(state, Duration::from_millis(10), 44_000, || {
                make_window("ShouldNotRun.exe")
            })
            .await;

        assert_eq!(
            hard_degraded.probe_status,
            TrackingRuntimeProbeStatus::HardDegradedFallback
        );
        assert_eq!(hard_degraded.window.exe_name, "Code.exe");
        assert_eq!(hard_degraded.probe_diagnostics.recovery_attempt_count, 2);
    });
}
