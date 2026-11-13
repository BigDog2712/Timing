//! `runtime_diagnostics.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;

#[test]
fn bounded_native_exception_history_is_written_without_truncation() {
    use crate::infra::insight::windows::native_probe::{self, NativeProbeExit, NativeProbeFault};
    let fault = NativeProbeFault {
        process_id: u32::MAX,
        thread_id: u32::MAX,
        code: u32::MAX,
        flags: u32::MAX,
        request_id: u64::MAX.to_string(),
        phase: "waiting-for-request".into(),
        exception_address: "0xffffffffffffffff".into(),
        instruction_pointer: "0xffffffffffffffff".into(),
        stack_pointer: "0xffffffffffffffff".into(),
        parameters: vec!["0xffffffffffffffff".into(); 15],
        image_base: Some("0xffffffffffffffff".into()),
        image_path: Some("测".repeat(260)),
        image_path_truncated: true,
    };
    let exit = NativeProbeExit {
        process_id: u32::MAX,
        code: u32::MAX,
        observed_at_ms: u64::MAX,
        created_filetime: Some(u64::MAX.to_string()),
        exited_filetime: Some(u64::MAX.to_string()),
        termination_requested: false,
        cleanup_elapsed_ms: Some(u64::MAX),
        fault: Some(fault),
    };
    let mut native = serde_json::to_value(native_probe::diagnostics()).unwrap();
    for (index, value) in native.as_array_mut().unwrap().iter_mut().enumerate() {
        value["last_exit"] = serde_json::to_value(&exit).unwrap();
        value["last_abnormal_exit"] = serde_json::to_value(&exit).unwrap();
        if index == 1 || index == 2 {
            value["shell"] = serde_json::json!({
                "requests":u64::MAX, "failed":u64::MAX,
                "last_exit":exit, "last_abnormal_exit":exit,
            });
        }
    }
    let snapshot =
        serde_json::json!({"native":native, "other_tracking_fields":"x".repeat(4096)});
    assert!(serde_json::to_vec(&snapshot).unwrap().len() > 16 * 1024);
    let expected = snapshot.clone();
    let (sent, received) = mpsc::sync_channel(1);
    let observer = RuntimeDiagnostics::start_with_writer(
        move || (false, snapshot.clone()),
        move |bytes| {
            assert!(bytes.len() <= FRAME_LIMIT);
            let _ = sent.try_send(serde_json::from_slice::<Value>(bytes).unwrap());
            Ok(())
        },
        Duration::from_millis(5),
    )
    .unwrap();
    let frame = received.recv_timeout(Duration::from_secs(3)).unwrap();
    assert_eq!(frame["snapshot"], expected);
    assert_eq!(observer.output_counts(), (0, 0));
    observer.stop();
}
#[test]
fn diagnostic_comparison_switch_requires_isolated_debug_profile() {
    for debug in [false, true] {
        for isolated in [None, Some("0"), Some("1"), Some("true")] {
            for disabled in [None, Some("0"), Some("1"), Some("true")] {
                assert_eq!(
                    diagnostics_enabled(debug, isolated, disabled),
                    !(debug && isolated == Some("1") && disabled == Some("1")),
                    "diagnostic comparison profile: debug={debug} isolated={isolated:?} disabled={disabled:?}"
                );
            }
        }
    }
}

#[test]
fn observer_and_writer_panics_are_joined_without_hanging_shutdown() {
    for panic_in_observer in [true, false] {
        let (entered, received) = mpsc::sync_channel(1);
        let observer_entered = entered.clone();
        let observer = RuntimeDiagnostics::start_with_writer(
            move || {
                if panic_in_observer {
                    let _ = observer_entered.try_send(());
                    panic!("controlled diagnostic observer panic");
                }
                (true, serde_json::json!({"stage": "foreground"}))
            },
            move |_| {
                let _ = entered.try_send(());
                panic!("controlled diagnostic writer panic");
            },
            Duration::from_millis(5),
        )
        .unwrap();
        received.recv_timeout(Duration::from_secs(3)).unwrap();
        observer.stop();
        assert!(observer.observer.lock().unwrap().is_none());
        assert!(observer.writer.lock().unwrap().is_none());
        observer.stop();
    }
}

#[test]
fn shutdown_does_not_wait_indefinitely_for_a_blocked_writer() {
    let (entered, received) = mpsc::sync_channel(1);
    let (release, blocked) = mpsc::sync_channel(1);
    let observer = RuntimeDiagnostics::start_with_writer(
        || (false, serde_json::json!({"stage": "waiting"})),
        move |_| {
            let _ = entered.try_send(());
            let _ = blocked.recv_timeout(Duration::from_secs(5));
            Ok(())
        },
        Duration::from_millis(5),
    )
    .unwrap();
    received.recv_timeout(Duration::from_secs(3)).unwrap();
    let started = Instant::now();
    observer.stop();
    assert!(started.elapsed() < Duration::from_secs(2));
    assert!(observer.observer.lock().unwrap().is_none());
    assert!(
        observer.writer.lock().unwrap().is_some(),
        "retain the blocked writer handle until it exits"
    );
    release.send(()).unwrap();
    observer.stop();
    assert!(observer.writer.lock().unwrap().is_none());
}

#[test]
fn full_diagnostic_queue_and_busy_executor_do_not_stop_observation() {
    let calls = Arc::new(AtomicU64::new(0));
    let observed = calls.clone();
    let (release, held) = mpsc::channel();
    let mut held = Some(held);
    let observer = RuntimeDiagnostics::start_with_writer(
        move || {
            let n = observed.fetch_add(1, Ordering::Relaxed);
            (n.is_multiple_of(2), serde_json::json!({"stage":"foreground"}))
        },
        move |_| {
            if let Some(held) = held.take() {
                let _ = held.recv_timeout(Duration::from_secs(5));
            }
            Ok(())
        },
        Duration::from_millis(5),
    )
    .unwrap();
    let executor = tokio::runtime::Builder::new_current_thread()
        .build()
        .unwrap();
    executor.block_on(async {
        let deadline = Instant::now() + Duration::from_secs(3);
        // Deliberately do not yield this runtime's sole worker.
        while observer.output_counts().0 == 0 && Instant::now() < deadline {
            std::hint::spin_loop();
        }
    });
    release.send(()).unwrap();
    observer.stop();
    assert!(calls.load(Ordering::Relaxed) > 17);
    assert!(
        observer.output_counts().0 > 0,
        "full writer queue must drop diagnostics, not block observation"
    );
    assert!(observer.writer.lock().unwrap().is_none());
}
#[test]
fn observer_runs_without_tokio_and_unwritable_logs_do_not_block_it() {
    let directory =
        std::env::temp_dir().join(format!("patina-observer-{}", uuid::Uuid::new_v4()));
    fs::write(&directory, b"not a directory").unwrap();
    let (observed, receiver) = mpsc::sync_channel(1);
    let observer = RuntimeDiagnostics::start(directory.clone(), move || {
        let _ = observed.try_send(());
        (true, serde_json::json!({ "stage": "foreground" }))
    })
    .unwrap();
    receiver.recv_timeout(Duration::from_secs(3)).unwrap();
    observer.stop();
    assert!(observer.observer.lock().unwrap().is_none());
    assert!(observer.writer.lock().unwrap().is_none());
    assert_eq!(observer.output_counts(), (0, 1));
    fs::remove_file(directory).unwrap();
}

#[test]
fn oversized_diagnostics_are_counted_and_never_written() {
    let directory = std::env::temp_dir().join(format!("patina-log-{}", uuid::Uuid::new_v4()));
    let (sent, received) = mpsc::sync_channel(1);
    let observer = RuntimeDiagnostics::start(directory.clone(), move || {
        let _ = sent.try_send(());
        (
            false,
            serde_json::json!({"payload": "x".repeat(FRAME_LIMIT)}),
        )
    })
    .unwrap();
    received.recv_timeout(Duration::from_secs(3)).unwrap();
    observer.stop();
    assert_eq!(observer.output_counts(), (1, 0));
    assert!(!directory.exists());
}

#[test]
fn diagnostic_partial_frame_recovery_preserves_complete_lines_at_every_cut() {
    let directory =
        std::env::temp_dir().join(format!("patina-partial-log-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let file = directory.join("runtime.jsonl");
    let previous = b"{\"sequence\":1}\n";
    let interrupted = "{\"sequence\":2,\"text\":\"部分写入\"}\n".as_bytes();
    let recovered = b"{\"sequence\":3}\n";
    for cut in 0..interrupted.len() {
        let mut bytes = previous.to_vec();
        bytes.extend_from_slice(&interrupted[..cut]);
        fs::write(&file, bytes).unwrap();
        append_rotating(&directory, recovered).unwrap();
        let actual = fs::read(&file).unwrap();
        let expected = [previous.as_slice(), recovered.as_slice()].concat();
        assert_eq!(actual, expected, "incomplete diagnostic prefix of {cut} bytes must not corrupt the first recovered frame");
    }
    fs::remove_file(file).unwrap();
    fs::remove_dir(directory).unwrap();
}

#[test]
fn diagnostic_partial_tail_is_removed_before_rotation_decision() {
    let directory =
        std::env::temp_dir().join(format!("patina-partial-limit-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let file = directory.join("runtime.jsonl");
    let recovered = b"{\"sequence\":3}\n";
    let mut complete = vec![b' '; LOG_LIMIT as usize - recovered.len()];
    complete[0] = b'0';
    *complete.last_mut().unwrap() = b'\n';
    let mut interrupted = complete.clone();
    interrupted.extend_from_slice(b"{\"sequence\":");
    fs::write(&file, interrupted).unwrap();
    append_rotating(&directory, recovered).unwrap();
    assert_eq!(
        fs::read(&file).unwrap(),
        [complete, recovered.to_vec()].concat()
    );
    assert!(!directory.join("runtime.1.jsonl").exists());
    fs::remove_file(file).unwrap();
    fs::remove_dir(directory).unwrap();
}

#[test]
fn diagnostic_partial_write_failure_is_counted_and_next_frame_recovers() {
    let directory =
        std::env::temp_dir().join(format!("patina-partial-writer-{}", uuid::Uuid::new_v4()));
    fs::create_dir(&directory).unwrap();
    let output = directory.clone();
    let calls = Arc::new(AtomicU64::new(0));
    let sampled = calls.clone();
    let recovered = Arc::new(std::sync::atomic::AtomicBool::new(false));
    let next_snapshot = recovered.clone();
    let mut first = true;
    let (written, received) = mpsc::sync_channel(1);
    let observer = RuntimeDiagnostics::start_with_writer(
        move || {
            let sequence = sampled.fetch_add(1, Ordering::Relaxed);
            (
                next_snapshot.load(Ordering::Acquire),
                serde_json::json!({"sequence": sequence}),
            )
        },
        move |frame| {
            if first {
                first = false;
                // A real file retains the prefix; the injected error models
                // a write that fails after accepting some bytes.
                fs::write(output.join("runtime.jsonl"), &frame[..frame.len() / 2])?;
                return Err(std::io::Error::other("controlled partial write"));
            }
            append_rotating(&output, frame)?;
            let _ = written.try_send(());
            Ok(())
        },
        Duration::from_millis(5),
    )
    .unwrap();
    let deadline = Instant::now() + Duration::from_secs(3);
    while observer.output_counts().1 == 0 && Instant::now() < deadline {
        std::thread::sleep(Duration::from_millis(5));
    }
    assert_eq!(observer.output_counts().1, 1);
    recovered.store(true, Ordering::Release);
    received.recv_timeout(Duration::from_secs(3)).unwrap();
    observer.stop();
    assert!(calls.load(Ordering::Relaxed) >= 2);
    assert_eq!(observer.output_counts(), (0, 1));
    assert!(observer.observer.lock().unwrap().is_none());
    assert!(observer.writer.lock().unwrap().is_none());
    let contents = fs::read_to_string(directory.join("runtime.jsonl")).unwrap();
    let frames = contents
        .lines()
        .map(|line| serde_json::from_str::<Value>(line).unwrap())
        .collect::<Vec<_>>();
    assert!(!frames.is_empty());
    assert!(frames[0]["snapshot"]["sequence"].as_u64().unwrap() >= 1);
    assert_eq!(frames[0]["output_write_failed"], 1);
    fs::remove_file(directory.join("runtime.jsonl")).unwrap();
    fs::remove_dir(directory).unwrap();
}

#[test]
fn diagnostic_rotation_has_a_fixed_file_and_byte_bound() {
    let directory = std::env::temp_dir().join(format!("patina-log-{}", uuid::Uuid::new_v4()));
    let mut frame = vec![b'x'; LOG_LIMIT as usize];
    *frame.last_mut().unwrap() = b'\n';
    for _ in 0..8 {
        append_rotating(&directory, &frame).unwrap();
    }
    let files = fs::read_dir(&directory)
        .unwrap()
        .map(Result::unwrap)
        .collect::<Vec<_>>();
    assert_eq!(files.len(), LOG_FILES);
    assert!(files
        .iter()
        .all(|file| file.metadata().unwrap().len() <= LOG_LIMIT));
    for file in files {
        fs::remove_file(file.path()).unwrap();
    }
    fs::remove_dir(directory).unwrap();
}
