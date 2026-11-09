//! `contracts.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::{
    AudioProbeStatus, AudioSessionFact, AudioSignalState, AudioSnapshot,
    SustainedParticipationAppIdentity,
};

#[test]
fn no_audio_snapshot_is_successful_empty_result() {
    let snapshot = AudioSnapshot::empty_success(1_000, 15_000);

    assert_eq!(snapshot.probe_status, AudioProbeStatus::Ok);
    assert!(snapshot.sessions.is_empty());
    assert_eq!(snapshot.signal_state(2_000), AudioSignalState::NoAudio);
}

#[test]
fn probe_fault_is_not_treated_as_no_audio() {
    let snapshot =
        AudioSnapshot::probe_unavailable(1_000, 15_000, AudioProbeStatus::Timeout, Some(500));

    assert_eq!(
        snapshot.signal_state(2_000),
        AudioSignalState::ProbeUnavailable
    );
}

#[test]
fn stale_snapshot_becomes_stale_state() {
    let snapshot = AudioSnapshot::empty_success(1_000, 15_000);

    assert_eq!(
        snapshot.signal_state(20_001),
        AudioSignalState::StaleSnapshot
    );
}

#[test]
fn active_audio_snapshot_reports_active_state() {
    let mut snapshot = AudioSnapshot::empty_success(1_000, 15_000);
    snapshot.sessions.push(AudioSessionFact {
        session_id: "123:potplayer.exe".into(),
        process_id: 123,
        exe_name: "PotPlayer.exe".into(),
        process_path: None,
        source_identity: Some(SustainedParticipationAppIdentity::Vlc),
        state: AudioSignalState::Active,
        first_observed_at_ms: 1_000,
        last_observed_at_ms: 1_000,
    });

    assert_eq!(snapshot.signal_state(2_000), AudioSignalState::Active);
}
