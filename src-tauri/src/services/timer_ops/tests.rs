//! `fold_session` 的判据。
//!
//! 每条用例都对应 §7 里的一条硬约定；注释里写明「改坏了哪条会变红」，
//! 因为这一层唯一的真值就是两端折叠结果必须逐位相同。

use super::{fold_session, FoldedBlock, IgnoreReason, TimerOp, TimerOpKind};

const PC: &str = "aaaaaaaaaaaa";
const PHONE: &str = "bbbbbbbbbbbb";
const ITEM: &str = "i:aaaaaaaaaaaa:7";
const SESSION: &str = "t:aaaaaaaaaaaa:42";

fn op(kind: TimerOpKind, at_ms: i64, device: &str, op_id: i64) -> TimerOp {
    TimerOp {
        uid: format!("p:{device}:{op_id}"),
        op_id,
        device_id: device.to_string(),
        session_uid: SESSION.to_string(),
        item_uid: ITEM.to_string(),
        kind,
        at_ms,
        payload: None,
    }
}

fn block(ops: &[TimerOp]) -> FoldedBlock {
    fold_session(ops)
        .block
        .expect("session with a start must fold into a block")
}

#[test]
fn start_then_stop_yields_the_exact_span() {
    let folded = block(&[
        op(TimerOpKind::Start, 1_000, PC, 1),
        op(TimerOpKind::Stop, 61_000, PC, 2),
    ]);
    assert_eq!(folded.started_at_ms, 1_000);
    assert_eq!(folded.ended_at_ms, Some(61_000));
    assert_eq!(folded.accumulated_sec(), 60);
    assert_eq!(folded.wall_clock_ms(), Some(60_000));
    assert!(!folded.is_running());
    assert_eq!(
        folded.device_id, PC,
        "发起设备不是「本机」，是 start 的属主"
    );
}

/// 暂停的那段时间**不**计入时长，但计入墙钟跨度。两个口径不能混。
#[test]
fn pause_resume_accumulates_only_the_running_parts() {
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Pause, 10_000, PC, 2),
        op(TimerOpKind::Resume, 30_000, PC, 3),
        op(TimerOpKind::Stop, 40_000, PC, 4),
    ]);
    assert_eq!(folded.accumulated_sec(), 20);
    assert_eq!(folded.wall_clock_ms(), Some(40_000));
}

/// 连续两次 pause：第二次是「已经是暂停态」的无操作。
/// 改坏的样子：把 `running_since.take()` 换成 `unwrap_or(上次结算点)`，同一段会被累加两次。
#[test]
fn duplicate_pause_does_not_double_count() {
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Pause, 10_000, PC, 2),
        op(TimerOpKind::Pause, 20_000, PC, 3),
        op(TimerOpKind::Stop, 25_000, PC, 4),
    ]);
    assert_eq!(folded.accumulated_sec(), 10);
}

/// 同步拉到的顺序不可控（按天分片、多端追加），折叠必须与输入顺序无关。
#[test]
fn input_order_does_not_matter() {
    let ordered = [
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Pause, 10_000, PC, 2),
        op(TimerOpKind::Resume, 30_000, PC, 3),
        op(TimerOpKind::Stop, 40_000, PC, 4),
    ];
    let shuffled = [
        ordered[2].clone(),
        ordered[0].clone(),
        ordered[3].clone(),
        ordered[1].clone(),
    ];
    assert_eq!(block(&ordered), block(&shuffled));
}

/// 时钟回拨：`stop` 的 `at_ms` 落在 `start` 之前。
///
/// 这一条钉的是**单调钳制**而不是排序。没有钳制时，按 `at_ms` 排序会让 `stop`
/// 排到 `start` 前面、被判成「没有 start 的事件」忽略 —— 会话永远结束不了
/// （故障现象：手机上点了结束，电脑上药丸一直在跑，且两边都不报错）。
/// 钳制后它折叠成零长会话：时间不可信，但状态收敛。
#[test]
fn clock_rollback_is_clamped_to_a_zero_length_session() {
    let folded = block(&[
        op(TimerOpKind::Start, 100_000, PC, 9),
        op(TimerOpKind::Stop, 40_000, PC, 1),
    ]);
    assert_eq!(
        folded.ended_at_ms,
        Some(100_000),
        "结束时刻被钳到不早于起点"
    );
    assert_eq!(folded.accumulated_ms, 0, "负区间一律夹到 0，不能出现负时长");
}

/// 两端同时结束：两条 stop，取排序键最小的一条定局，另一条不改变结果。
/// 改坏的样子：让后到的 stop 覆盖 `ended_at` —— 两端 fold 出不同的结束时刻，
/// 而这种不一致只有在两端都同步过完整历史后才显形。
#[test]
fn two_stops_converge_on_the_earliest_sort_key() {
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 50_000, PHONE, 2),
        op(TimerOpKind::Stop, 59_000, PC, 3),
    ]);
    assert_eq!(folded.ended_at_ms, Some(50_000));

    let reversed = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 59_000, PC, 3),
        op(TimerOpKind::Stop, 50_000, PHONE, 2),
    ]);
    assert_eq!(folded, reversed, "两端折叠必须逐位相同");
}

/// stop 之后的 resume 一律忽略。复活会话 = 块还在跑、用户其实已经走了。
#[test]
fn resume_after_stop_is_ignored() {
    let result = fold_session(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 60_000, PHONE, 2),
        op(TimerOpKind::Resume, 90_000, PC, 3),
    ]);
    let folded = result.block.expect("block");
    assert_eq!(folded.ended_at_ms, Some(60_000));
    assert!(!folded.is_running());
    assert_eq!(result.ignored.len(), 1);
    assert_eq!(result.ignored[0].reason, IgnoreReason::AfterStop);
}

#[test]
fn same_device_undo_reopens_and_the_next_stop_wins() {
    let ops = [
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 60_000, PC, 2),
        op(TimerOpKind::Resume, 62_000, PC, 3),
        op(TimerOpKind::Stop, 90_000, PC, 4),
    ];
    let reopened = block(&ops[..3]);
    assert_eq!(reopened.ended_at_ms, None);
    assert_eq!(reopened.running_since_ms, Some(62_000));
    let folded = block(&ops);
    assert_eq!(folded.ended_at_ms, Some(90_000));
    assert_eq!(folded.accumulated_sec(), 88);
}

#[test]
fn late_resume_after_own_stop_stays_ignored() {
    let result = fold_session(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 60_000, PC, 2),
        op(TimerOpKind::Resume, 63_201, PC, 3),
    ]);
    assert_eq!(result.block.expect("block").ended_at_ms, Some(60_000));
    assert_eq!(result.ignored[0].reason, IgnoreReason::AfterStop);
}

/// 分片不完整时可能只拉到 stop（start 在另一天的文件里）：必须忽略而不是造一条零长块。
#[test]
fn ops_without_start_are_ignored() {
    let result = fold_session(&[op(TimerOpKind::Stop, 60_000, PC, 1)]);
    assert!(result.block.is_none());
    assert_eq!(result.ignored.len(), 1);
    assert_eq!(result.ignored[0].reason, IgnoreReason::NoStart);
}

/// 同一会话只能开一次。重复 start 不重置起点（重置会把已跑的时间抹掉）。
#[test]
fn duplicate_start_does_not_reset_the_origin() {
    let result = fold_session(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Start, 30_000, PHONE, 2),
        op(TimerOpKind::Stop, 60_000, PC, 3),
    ]);
    let folded = result.block.expect("block");
    assert_eq!(folded.started_at_ms, 0);
    assert_eq!(folded.accumulated_sec(), 60);
    assert_eq!(result.ignored[0].reason, IgnoreReason::DuplicateStart);
}

#[test]
fn adjust_moves_the_start_and_bad_payload_is_ignored() {
    let mut adjust = op(TimerOpKind::Adjust, 5_000, PC, 2);
    adjust.payload = Some(r#"{"started_at":2000}"#.to_string());
    let folded = block(&[op(TimerOpKind::Start, 0, PC, 1), adjust]);
    assert_eq!(folded.started_at_ms, 2_000);

    let mut broken = op(TimerOpKind::Adjust, 5_000, PC, 2);
    broken.payload = Some("not-json".to_string());
    let result = fold_session(&[op(TimerOpKind::Start, 0, PC, 1), broken]);
    assert_eq!(result.block.expect("block").started_at_ms, 0);
    assert_eq!(result.ignored[0].reason, IgnoreReason::MalformedAdjust);
}

/// 计时中换事项：改坏的样子是 fold 只认 `start` 的事项 —— 对端整段记在旧事项名下。
#[test]
fn item_switch_adjust_moves_the_item_but_not_the_time() {
    let mut switch = op(TimerOpKind::Adjust, 5_000, PC, 2);
    switch.payload = Some(super::item_switch_payload("i:aaaaaaaaaaaa:9"));
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        switch,
        op(TimerOpKind::Stop, 60_000, PC, 3),
    ]);
    assert_eq!(folded.item_uid, "i:aaaaaaaaaaaa:9");
    assert!(folded.item_switched);
    assert_eq!(folded.started_at_ms, 0);
    assert_eq!(folded.accumulated_sec(), 60);

    let untouched = block(&[op(TimerOpKind::Start, 0, PC, 1)]);
    assert_eq!(untouched.item_uid, ITEM);
    assert!(!untouched.item_switched, "没换过事项时物化不得改写本机事项");

    let mut empty = op(TimerOpKind::Adjust, 5_000, PC, 2);
    empty.payload = Some(r#"{"item_uid":""}"#.to_string());
    let result = fold_session(&[op(TimerOpKind::Start, 0, PC, 1), empty]);
    assert_eq!(result.ignored[0].reason, IgnoreReason::MalformedAdjust);
}

/// `drop` 只打标记：事件本身不能删（删了就对端重推时又活了）。
#[test]
fn drop_marks_the_block_without_removing_events() {
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Drop, 10_000, PC, 2),
    ]);
    assert!(folded.dropped);
}

#[test]
fn discarded_short_session_is_not_resurrected_by_a_stop_event() {
    let dropped = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Drop, 10_000, PC, 2),
    ]);
    assert!(dropped.dropped);
    assert_eq!(dropped.ended_at_ms, None);

    let legacy_pair = fold_session(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 10_000, PC, 2),
        op(TimerOpKind::Drop, 10_000, PC, 3),
    ]);
    assert!(!legacy_pair.block.expect("legacy block").dropped);
}

/// 落 `accumulated_sec` 是整秒（向下取整）：1500ms 记 1 秒，不能四舍五入成 2。
#[test]
fn accumulated_sec_floors() {
    let folded = block(&[
        op(TimerOpKind::Start, 0, PC, 1),
        op(TimerOpKind::Stop, 1_500, PC, 2),
    ]);
    assert_eq!(folded.accumulated_ms, 1_500);
    assert_eq!(folded.accumulated_sec(), 1);
}
