use serde_json::Value;
use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Seek, SeekFrom, Write},
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    thread::JoinHandle,
    time::{Duration, Instant},
};

const LOG_LIMIT: u64 = 2 * 1024 * 1024;
const LOG_FILES: usize = 5;
const FRAME_LIMIT: usize = 32 * 1024;

pub(crate) fn enabled_for_process() -> bool {
    diagnostics_enabled(
        cfg!(debug_assertions),
        std::env::var("PATINA_E2E").ok().as_deref(),
        std::env::var("PATINA_E2E_DISABLE_DIAGNOSTICS")
            .ok()
            .as_deref(),
    )
}

fn diagnostics_enabled(debug: bool, isolated: Option<&str>, disabled: Option<&str>) -> bool {
    // Whole-application comparisons may omit the observer only in the isolated
    // debug profile. Release and ordinary development runs retain diagnostics.
    !(debug && isolated == Some("1") && disabled == Some("1"))
}

pub(crate) struct RuntimeDiagnostics {
    stop: SyncSender<()>,
    observer: Mutex<Option<JoinHandle<()>>>,
    writer: Mutex<Option<JoinHandle<()>>>,
    counters: Arc<OutputCounters>,
}

#[derive(Default)]
struct OutputCounters {
    dropped: AtomicU64,
    write_failed: AtomicU64,
}

impl RuntimeDiagnostics {
    pub(crate) fn start(
        directory: PathBuf,
        snapshot: impl Fn() -> (bool, Value) + Send + 'static,
    ) -> std::io::Result<Self> {
        Self::start_with_writer(
            snapshot,
            move |frame| append_rotating(&directory, frame),
            Duration::from_secs(1),
        )
    }

    fn start_with_writer(
        snapshot: impl Fn() -> (bool, Value) + Send + 'static,
        mut write_frame: impl FnMut(&[u8]) -> std::io::Result<()> + Send + 'static,
        interval: Duration,
    ) -> std::io::Result<Self> {
        let (frames, receiver) = mpsc::sync_channel::<Vec<u8>>(16);
        let counters = Arc::new(OutputCounters::default());
        let writer_counters = counters.clone();
        let writer = std::thread::Builder::new()
            .name("patina-diagnostic-writer".into())
            .spawn(move || {
                while let Ok(frame) = receiver.recv() {
                    // Diagnostic I/O never shares the observer or tracker thread.
                    if write_frame(&frame).is_err() {
                        writer_counters.write_failed.fetch_add(1, Ordering::Relaxed);
                    }
                }
            })?;
        let (stop, stopped) = mpsc::sync_channel(1);
        let observer_counters = counters.clone();
        let run_id = uuid::Uuid::new_v4().to_string();
        let observer = std::thread::Builder::new()
            .name("patina-runtime-observer".into())
            .spawn(move || {
                let mut last_stalled = false;
                let mut last_written = Instant::now();
                let mut first = true;
                loop {
                    let (stalled, value) = snapshot();
                    if first
                        || stalled != last_stalled
                        || last_written.elapsed() >= Duration::from_secs(60)
                    {
                        let envelope = serde_json::json!({
                            "run_id": run_id, "app_version": env!("CARGO_PKG_VERSION"),
                            "output_dropped": observer_counters.dropped.load(Ordering::Relaxed),
                            "output_write_failed": observer_counters.write_failed.load(Ordering::Relaxed),
                            "snapshot": value,
                        });
                        if let Ok(mut frame) = serde_json::to_vec(&envelope) {
                            if frame.len() < FRAME_LIMIT {
                                frame.push(b'\n');
                                if frames.try_send(frame).is_err() {
                                    observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                                }
                            } else {
                                observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                            }
                        } else {
                            observer_counters.dropped.fetch_add(1, Ordering::Relaxed);
                        }
                        first = false;
                        last_stalled = stalled;
                        last_written = Instant::now();
                    }
                    match stopped.recv_timeout(interval) {
                        Err(mpsc::RecvTimeoutError::Timeout) => (),
                        _ => break,
                    }
                }
            })?;
        Ok(Self {
            stop,
            observer: Mutex::new(Some(observer)),
            writer: Mutex::new(Some(writer)),
            counters,
        })
    }

    pub(crate) fn output_counts(&self) -> (u64, u64) {
        (
            self.counters.dropped.load(Ordering::Relaxed),
            self.counters.write_failed.load(Ordering::Relaxed),
        )
    }

    pub(crate) fn stop(&self) {
        let _ = self.stop.try_send(());
        if let Ok(mut thread) = self.observer.lock() {
            if let Some(thread) = thread.take() {
                let _ = thread.join();
            }
        }
        // A stalled filesystem must not block shutdown indefinitely. Retain the
        // handle until the writer actually exits; normal exits drain and join it.
        if let Ok(mut writer) = self.writer.lock() {
            let deadline = Instant::now() + Duration::from_millis(500);
            while writer.as_ref().is_some_and(|thread| !thread.is_finished())
                && Instant::now() < deadline
            {
                std::thread::sleep(Duration::from_millis(5));
            }
            if writer.as_ref().is_some_and(JoinHandle::is_finished) {
                if let Some(thread) = writer.take() {
                    let _ = thread.join();
                }
            }
        }
    }
}

impl Drop for RuntimeDiagnostics {
    fn drop(&mut self) {
        self.stop();
    }
}

fn append_rotating(directory: &std::path::Path, frame: &[u8]) -> std::io::Result<()> {
    fs::create_dir_all(directory)?;
    let path = directory.join("runtime.jsonl");
    let mut file = OpenOptions::new()
        .create(true)
        .read(true)
        .write(true)
        .truncate(false)
        .open(&path)?;
    discard_partial_frame(&mut file)?;
    if file.metadata()?.len() + frame.len() as u64 > LOG_LIMIT {
        drop(file);
        let oldest = directory.join(format!("runtime.{}.jsonl", LOG_FILES - 1));
        if oldest.exists() {
            fs::remove_file(oldest)?;
        }
        for index in (1..LOG_FILES - 1).rev() {
            let previous = directory.join(format!("runtime.{index}.jsonl"));
            if previous.exists() {
                fs::rename(
                    previous,
                    directory.join(format!("runtime.{}.jsonl", index + 1)),
                )?;
            }
        }
        fs::rename(&path, directory.join("runtime.1.jsonl"))?;
        file = OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(path)?;
    }
    // This directory has one writer. Windows append-only handles cannot repair
    // a partial tail with set_len, so append explicitly after recovery.
    file.seek(SeekFrom::End(0))?;
    file.write_all(frame)
}

fn discard_partial_frame(file: &mut File) -> std::io::Result<()> {
    let mut end = file.metadata()?.len();
    // Files produced here are bounded. An externally oversized file goes
    // straight to rotation without an unbounded recovery scan.
    if end == 0 || end > LOG_LIMIT {
        return Ok(());
    }
    file.seek(SeekFrom::End(-1))?;
    let mut last = [0];
    file.read_exact(&mut last)?;
    if last[0] == b'\n' {
        return Ok(());
    }
    // A failed write or process exit may leave even a partial UTF-8 sequence.
    // Preserve every newline-terminated frame and discard only the suffix.
    let mut buffer = vec![0; FRAME_LIMIT];
    while end > 0 {
        let start = end.saturating_sub(FRAME_LIMIT as u64);
        let bytes = &mut buffer[..(end - start) as usize];
        file.seek(SeekFrom::Start(start))?;
        file.read_exact(bytes)?;
        if let Some(newline) = bytes.iter().rposition(|byte| *byte == b'\n') {
            return file.set_len(start + newline as u64 + 1);
        }
        end = start;
    }
    file.set_len(0)
}

#[cfg(test)]
#[path = "runtime_diagnostics_mod_tests.rs"]
mod tests;
