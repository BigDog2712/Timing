//! `decision` 的纯判定、注册表语义与裁决动作映射。
//!
//! 为什么不放在 `decision.rs` 里：那个文件已经贴 300 行门禁；且这些用例验的是
//! **状态机的分支覆盖**，与实现文件的行数无关，单独一份更好读。
//!
//! 这里刻意**不**起数据库、不碰文件系统：`resolve` 的 A/B 两路要真写 md 文件与业务库，
//! 属集成面（`src/tests/md_decision_audit.rs` 验 Defer 一路 + 审计落库）。
//! 单测只钉「选哪个按钮 → 走哪条动作 → 状态怎么变」。

use chrono::NaiveDate;

use super::{
    action_for, awaiting, pending, promote_all, registry, Action, ConflictMode, ConflictState,
};
use crate::models::md_sync::{Decision, MdSyncBinding, MdSyncKind};

fn binding(kind: MdSyncKind, heading: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind,
        enabled: true,
        root: "/tmp/vault".into(),
        file: "{date}.md".into(),
        heading: heading.into(),
    }
}

fn day() -> NaiveDate {
    NaiveDate::from_ymd_opt(2026, 11, 16).expect("2026-11-16 是合法日期")
}

fn register(b: &MdSyncBinding, state: ConflictState) {
    registry::register(
        b,
        day(),
        "/tmp/vault/2026-11-16.md".into(),
        "old".into(),
        "new".into(),
        state,
    );
}

#[test]
fn conflict_mode_maps_to_state() {
    let _g = registry::test_guard();
    registry::clear();
    assert_eq!(ConflictMode::AutoMerge.state(), None, "自动合并无裁决");
    assert_eq!(
        ConflictMode::Awaiting.state(),
        Some(ConflictState::AwaitingDecision)
    );
    assert_eq!(
        ConflictMode::Pending.state(),
        Some(ConflictState::PendingDecision)
    );
}

/// 三档必须各走一条不同的动作。只钉「不是 Defer」是不够的：
/// A/B 若都映射成 Import，用户点「保留 Timing」会被 md 覆盖，测试照样绿。
#[test]
fn action_for_maps_abc_to_three_distinct_actions() {
    let _g = registry::test_guard();
    assert_eq!(action_for(Decision::OverwriteTiming), Action::Import);
    assert_eq!(action_for(Decision::KeepTiming), Action::Export);
    assert_eq!(action_for(Decision::Deferred), Action::Defer);
    assert_ne!(
        action_for(Decision::OverwriteTiming),
        action_for(Decision::KeepTiming),
        "覆盖与保留不能走同一个动作"
    );
}

/// 审计方向词汇必须与迁移 0012 的 `direction` 词汇表逐字一致。
/// 这条钉的是「写进库的字」，不是枚举名——改 serde 口径会当场红。
#[test]
fn decision_serde_matches_audit_vocabulary() {
    let _g = registry::test_guard();
    assert_eq!(Decision::OverwriteTiming.as_str(), "overwrite_timing");
    assert_eq!(Decision::KeepTiming.as_str(), "keep_timing");
    assert_eq!(Decision::Deferred.as_str(), "deferred");
    let json = serde_json::to_string(&Decision::OverwriteTiming).expect("Decision 可序列化");
    assert_eq!(json, "\"overwrite_timing\"");
}

#[test]
fn register_never_downgrades_awaiting_to_pending() {
    let _g = registry::test_guard();
    registry::clear();
    let b = binding(MdSyncKind::Timers, "#### 事项计时");
    register(&b, ConflictState::AwaitingDecision);
    register(&b, ConflictState::PendingDecision);
    let all = pending();
    assert_eq!(all.len(), 1, "同 id 幂等，不产生重复条目");
    assert_eq!(
        all[0].state,
        ConflictState::AwaitingDecision,
        "后台轮不得把前台待裁决降级"
    );
    registry::clear();
}

#[test]
fn promote_all_lifts_pending_to_awaiting() {
    let _g = registry::test_guard();
    registry::clear();
    let b = binding(MdSyncKind::Notes, "#### 便利贴");
    register(&b, ConflictState::PendingDecision);
    assert_eq!(awaiting().len(), 0, "挂起的不在可弹窗集合");
    promote_all();
    assert_eq!(awaiting().len(), 1, "提升后进入可弹窗集合");
    registry::clear();
}

/// `Deferred` 的语义是「挂回去等下次」，不是「处理完了」：条目必须还在，
/// 且回到 `PendingDecision`。若这里写成删除条目，用户点「暂不处理」等于永久丢弃
/// 这次冲突，两端内容从此各走各的。
#[test]
fn deferred_keeps_entry_and_returns_to_pending() {
    let _g = registry::test_guard();
    registry::clear();
    let b = binding(MdSyncKind::Timers, "#### 事项计时");
    register(&b, ConflictState::AwaitingDecision);
    let id = b.key();
    assert!(registry::snapshot(&id).is_some(), "先确认登记成功");

    registry::set_state(&id, ConflictState::PendingDecision);

    let entry = registry::snapshot(&id).expect("Deferred 后条目仍在");
    assert_eq!(
        entry.public.state,
        ConflictState::PendingDecision,
        "Deferred 后回到挂起"
    );
    assert_eq!(awaiting().len(), 0, "挂起后不再弹窗");
    registry::clear();
}

/// 展示行里的日期必须是本地日 `YYYY-MM-DD`，不是时间戳：
/// 前端按这个字符串分组「今天 / 往日」，格式一变就是全空列表。
#[test]
fn pending_row_carries_local_day_and_kind() {
    let _g = registry::test_guard();
    registry::clear();
    let b = binding(MdSyncKind::Timers, "#### 事项计时");
    register(&b, ConflictState::AwaitingDecision);
    let all = pending();
    assert_eq!(all.len(), 1);
    assert_eq!(all[0].date, "2026-11-16", "本地日格式 YYYY-MM-DD");
    assert_eq!(all[0].kind, MdSyncKind::Timers, "落点类型原样带出");
    assert_eq!(all[0].heading, "#### 事项计时");
    assert_eq!(all[0].id, b.key(), "id 必须与 binding.key() 同源");
    registry::clear();
}
