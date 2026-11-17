use super::{fold_session, IgnoreReason, RecordRevision, TimerOp, TimerOpKind};

fn revision(at_ms: i64, seq: i64, device: &str, note: &str, deleted_at: Option<i64>) -> TimerOp {
    let saved = RecordRevision {
        device_id: "aaaaaaaaaaaa".into(),
        item_uid: "i:aaaaaaaaaaaa:1".into(),
        started_at: 1000,
        ended_at: 41000,
        accumulated_sec: 20,
        note: Some(note.into()),
        mode: "countdown".into(),
        target_sec: Some(1500),
        deleted_at,
    };
    TimerOp {
        uid: format!("p:{device}:{seq}"),
        op_id: seq,
        device_id: device.into(),
        session_uid: "t:aaaaaaaaaaaa:1".into(),
        item_uid: saved.item_uid.clone(),
        kind: TimerOpKind::Adjust,
        at_ms,
        payload: Some(saved.payload()),
    }
}

#[test]
fn concurrent_record_revisions_have_a_deterministic_winner() {
    let a = revision(50_000, 1, "aaaaaaaaaaaa", "电脑", None);
    let b = revision(50_000, 1, "bbbbbbbbbbbb", "手机", None);
    let forward = fold_session(&[a.clone(), b.clone()]).block.unwrap();
    let reverse = fold_session(&[b, a]).block.unwrap();
    assert_eq!(forward, reverse);
    assert_eq!(forward.record.as_ref().unwrap().note.as_deref(), Some("手机"));
    assert_eq!(forward.accumulated_sec(), 20);
    assert_eq!(forward.device_id, "aaaaaaaaaaaa", "编辑设备不是记录属主");
}

#[test]
fn saved_record_delete_wins_even_over_a_later_concurrent_edit() {
    let deleted = revision(50_000, 1, "aaaaaaaaaaaa", "删除", Some(50_000));
    let edited = revision(60_000, 1, "bbbbbbbbbbbb", "迟到编辑", None);
    let forward = fold_session(&[deleted.clone(), edited.clone()]).block.unwrap();
    let reverse = fold_session(&[edited, deleted]).block.unwrap();
    assert_eq!(forward, reverse);
    assert!(forward.dropped);
    assert_eq!(forward.record.unwrap().deleted_at, Some(50_000));
}

#[test]
fn startless_split_revision_preserves_the_stop_author_for_undo() {
    let saved = revision(42_000, 11, "aaaaaaaaaaaa", "末段", None);
    let mut stop = saved.clone();
    stop.kind = TimerOpKind::Stop;
    stop.at_ms = 41_000;
    stop.op_id = 10;
    stop.payload = None;
    let mut resume = stop.clone();
    resume.kind = TimerOpKind::Resume;
    resume.at_ms = 42_100;
    resume.op_id = 12;
    let block = fold_session(&[resume, saved, stop]).block.unwrap();
    assert_eq!(block.ended_at_ms, None);
    assert_eq!(block.running_since_ms, Some(42_100));
    assert_eq!(block.accumulated_sec(), 20);
}

#[test]
fn pause_and_undo_settle_seconds_like_the_local_record() {
    let event = |kind, at_ms, seq| {
        let mut op = revision(at_ms, seq, "aaaaaaaaaaaa", "", None);
        op.kind = kind;
        op.payload = None;
        op
    };
    let paused = fold_session(&[
        event(TimerOpKind::Start, 0, 1), event(TimerOpKind::Pause, 30_600, 2),
        event(TimerOpKind::Resume, 40_000, 3), event(TimerOpKind::Stop, 41_600, 4),
    ]).block.unwrap();
    assert_eq!(paused.accumulated_sec(), 31);
    let undone = fold_session(&[
        event(TimerOpKind::Start, 0, 1), event(TimerOpKind::Stop, 1_500, 2),
        event(TimerOpKind::Resume, 2_000, 3), event(TimerOpKind::Stop, 3_500, 4),
    ]).block.unwrap();
    assert_eq!(undone.accumulated_sec(), 2);
}

#[test]
fn malformed_saved_revision_does_not_corrupt_a_valid_record() {
    let valid = revision(50_000, 1, "aaaaaaaaaaaa", "正确", None);
    for replacement in [
        serde_json::json!({ "record_v1": {} }),
        serde_json::json!({ "record_v1": null }),
    ] {
        let mut invalid = revision(60_000, 2, "aaaaaaaaaaaa", "错误", None);
        invalid.payload = Some(replacement.to_string());
        let folded = fold_session(&[valid.clone(), invalid]);
        assert_eq!(folded.block.unwrap().record.unwrap().note.as_deref(), Some("正确"));
        assert_eq!(folded.ignored[0].reason, IgnoreReason::MalformedAdjust);
    }
    let mut invalid = revision(60_000, 2, "aaaaaaaaaaaa", "错误", None);
    let mut value: serde_json::Value = serde_json::from_str(invalid.payload.as_deref().unwrap()).unwrap();
    value["record_v1"]["accumulated_sec"] = serde_json::json!(i64::MAX);
    invalid.payload = Some(value.to_string());
    let folded = fold_session(&[valid, invalid]);
    assert_eq!(folded.block.unwrap().accumulated_sec(), 20);
    assert_eq!(folded.ignored[0].reason, IgnoreReason::MalformedAdjust);
}
