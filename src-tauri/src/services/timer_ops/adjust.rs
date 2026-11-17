//! `adjust` 的两种载荷：改起点 `{"started_at": <ms>}`、换事项 `{"item_uid": "i:..."}`。
//!
//! 换事项复用 `adjust` 而不是新开 kind：`timer_ops.kind` 的 CHECK 写死在 0011 里，
//! 加 kind 要重建表；旧版本对端读到不认识的载荷只会记一条 `MalformedAdjust` 并忽略。

use super::{FoldedBlock, TimerOp};

/// 应用一条 `adjust`；载荷里没有任何可用字段时返回 `false`（调用方记 `MalformedAdjust`）。
///
/// 起点解析失败一律不兜底成 0：把起点折成 1970 会造出一条横跨半个世纪的块，
/// 污染所在那一整天的读模型 —— 宁可忽略这条 adjust 并上报。
pub(super) fn apply(block: &mut FoldedBlock, op: &TimerOp, last_applied: &mut i64) -> bool {
    let Some(value) = op
        .payload
        .as_deref()
        .and_then(|raw| serde_json::from_str::<serde_json::Value>(raw).ok())
    else {
        return false;
    };
    let started_at = value
        .get("started_at")
        .and_then(serde_json::Value::as_i64)
        .filter(|started| *started <= block.ended_at_ms.unwrap_or(i64::MAX));
    let item_uid = value
        .get("item_uid")
        .and_then(serde_json::Value::as_str)
        .filter(|uid| !uid.is_empty());
    if started_at.is_none() && item_uid.is_none() {
        return false;
    }
    if let Some(started) = started_at {
        block.started_at_ms = started;
        *last_applied = (*last_applied).max(started);
    }
    if let Some(uid) = item_uid {
        block.item_uid = uid.to_string();
        block.item_switched = true;
    }
    true
}

/// 换事项事件的载荷。
pub fn item_switch_payload(item_uid: &str) -> String {
    serde_json::json!({ "item_uid": item_uid }).to_string()
}
