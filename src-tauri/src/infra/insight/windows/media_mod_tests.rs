//! `media.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::map_playback_type;
use crate::models::insight::tracking::SystemMediaPlaybackType;
use windows::Media::MediaPlaybackType;

#[test]
fn busy_media_probe_cannot_starve_timeout_or_accumulate_retries() {
    use super::*;
    use std::time::Instant;

    let runtime = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .unwrap();
    let released = Arc::new(AtomicBool::new(false));
    let completed = Arc::new(AtomicBool::new(false));
    let release_probe = released.clone();
    let probe_completed = completed.clone();
    let state = MediaSignalSourceState::new();
    runtime.block_on(async {
        state
            .reconcile_with_probe(Duration::from_millis(20), move || {
                // Deliberately consume a worker without yielding; the deadline bounds
                // the failing implementation as well as the test's cleanup.
                let deadline = Instant::now() + Duration::from_secs(2);
                while !release_probe.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::hint::spin_loop();
                }
                probe_completed.store(true, Ordering::Release);
                Ok(None)
            })
            .await;
        let timed_out_before_completion = !completed.load(Ordering::Acquire);
        let in_flight_after_timeout = state.probe_in_flight.load(Ordering::Acquire);
        let retries = Arc::new(std::sync::atomic::AtomicUsize::new(0));
        for _ in 0..100 {
            let retries = retries.clone();
            state
                .reconcile_with_probe(Duration::from_millis(20), move || {
                    retries.fetch_add(1, Ordering::Relaxed);
                    Ok(None)
                })
                .await;
        }
        released.store(true, Ordering::Release);
        assert!(
            timed_out_before_completion,
            "native busy loop starved the async timeout"
        );
        assert!(in_flight_after_timeout);
        assert_eq!(retries.load(Ordering::Relaxed), 0);
        timeout(Duration::from_secs(3), async {
            while state.probe_in_flight.load(Ordering::Acquire) {
                tokio::task::yield_now().await;
            }
        })
        .await
        .expect("probe failed to release its in-flight guard");
        state
            .reconcile_with_probe(Duration::from_secs(1), || Ok(None))
            .await;
        assert!(!state.probe_in_flight.load(Ordering::Acquire));
    });
}

#[test]
fn busy_media_probe_does_not_stop_multi_worker_timers() {
    use super::*;
    use std::sync::mpsc;
    use std::time::Instant;

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(4)
        .enable_all()
        .build()
        .unwrap();
    let release = Arc::new(AtomicBool::new(false));
    let probe_release = release.clone();
    let (started_tx, started_rx) = mpsc::channel();
    let (timer_tx, timer_rx) = mpsc::channel();
    let probe = runtime.spawn(async move {
        // Let the workers park before a timer wakes the native probe. A busy
        // driver-owning worker must not strand the other timers while idle.
        sleep(Duration::from_millis(50)).await;
        MediaSignalSourceState::new()
            .reconcile_with_probe(Duration::from_millis(20), move || {
                started_tx.send(()).unwrap();
                let deadline = Instant::now() + Duration::from_secs(3);
                while !probe_release.load(Ordering::Acquire) && Instant::now() < deadline {
                    std::hint::spin_loop();
                }
                Ok(None)
            })
            .await;
    });
    let timer = runtime.spawn(async move {
        sleep(Duration::from_millis(150)).await;
        let _ = timer_tx.send(());
    });
    let started = started_rx.recv_timeout(Duration::from_secs(2));
    // This deadline runs outside Tokio so a frozen timer driver cannot also
    // freeze the test's failure detection or leave its busy probe running.
    let timer_result = timer_rx.recv_timeout(Duration::from_secs(1));
    release.store(true, Ordering::Release);
    runtime.block_on(async {
        probe.await.unwrap();
        timer.await.unwrap();
    });
    assert!(started.is_ok(), "probe did not start");
    assert!(
        timer_result.is_ok(),
        "one busy probe stalled all runtime timers"
    );
}

#[test]
fn media_playback_type_mapping_preserves_expected_categories() {
    assert_eq!(
        map_playback_type(MediaPlaybackType::Video),
        SystemMediaPlaybackType::Video
    );
    assert_eq!(
        map_playback_type(MediaPlaybackType::Music),
        SystemMediaPlaybackType::Audio
    );
    assert_eq!(
        map_playback_type(MediaPlaybackType::Image),
        SystemMediaPlaybackType::Image
    );
    assert_eq!(
        map_playback_type(MediaPlaybackType::Unknown),
        SystemMediaPlaybackType::Unknown
    );
}
