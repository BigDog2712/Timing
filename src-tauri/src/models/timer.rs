//! 计时器状态 DTO（`get_timer_state` 返回 / `timer:state-changed` 事件 payload）。
//! [V0.2.0] 叠加倒计时语义：`mode` / `remainingSec`（ADR-011）。

use serde::Serialize;

use crate::models::enums::timer_mode;
use crate::models::enums::timer_status;
use crate::models::enums::TrayStatus;
use crate::models::record::TimeRecord;

/// 计时器整体状态。字段与 `domain.ts::TimerState` 一一对应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerState {
    /// "idle" | "running" | "paused"
    pub status: String,
    /// running / paused 时非空；idle 时为 null
    pub session: Option<TimeRecord>,
    /// 最近使用的事项 id（默认 1）
    pub last_item_id: Option<i64>,
    /// 服务端快照：accumulatedSec + (running ? floor((now - runningSince)/1000) : 0)
    pub live_duration_sec: i64,
    /// [V0.2.0] 当前模式（idle 时 = "countup"）
    pub mode: String,
    /// [V0.2.0] 倒计时剩余秒数 = max(0, targetSec - liveDurationSec)；countup / idle 为 null
    pub remaining_sec: Option<i64>,
}

impl TimerState {
    pub fn idle(last_item_id: Option<i64>) -> Self {
        Self {
            status: timer_status::IDLE.to_string(),
            session: None,
            last_item_id,
            live_duration_sec: 0,
            mode: timer_mode::COUNTUP.to_string(),
            remaining_sec: None,
        }
    }
}

/// 倒计时到点结果（`countdown-finished` 事件源；ADR-011）。
///
/// `ended = true` 表示已自动结束（`saved`，时长钳到 target）；`false` 表示「仅通知 + 视觉提示」
/// （AC-62 默认：会话仍 `active`，不自动结束）。
#[derive(Debug, Clone)]
pub struct CountdownFired {
    /// 会话记录（自动结束为 `saved`；通知模式仍为 `active`）。
    pub record: TimeRecord,
    /// 目标秒数。
    pub target_sec: i64,
    /// 归属事项名（通知文案用；缺失为空串）。
    pub item_name: String,
    /// 是否已自动结束。
    pub ended: bool,
}

/// `countdown-finished` 事件载荷（= `domain.ts::CountdownFinishedPayload`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountdownFinished {
    pub session: TimeRecord,
    pub target_sec: i64,
}

/// 托盘菜单状态快照（ADR-013 §6.e 状态文本口径）。仅供 `infra::tray` 使用，不上 IPC。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TraySnapshot {
    pub status: TrayStatus,
    /// 当前会话归属事项名；空闲时为空串。
    pub item_name: String,
    /// 实时累计秒（`liveDurationSec` 同源）。
    pub duration_sec: i64,
    /// [V0.2.0] 倒计时剩余秒（仅 `TrayStatus::Countdown` 非空）。
    pub remaining_sec: Option<i64>,
}

impl TraySnapshot {
    /// 空闲快照（DB 不可用时的兜底）。
    pub fn idle() -> Self {
        Self {
            status: TrayStatus::Idle,
            item_name: String::new(),
            duration_sec: 0,
            remaining_sec: None,
        }
    }
}
