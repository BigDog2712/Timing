//! 枚举类型（字符串值与 `domain.ts` 联合类型一一对应）。

use serde::{Deserialize, Serialize};

/// 全局快捷键动作（[P1]；字符串值 snake_case）。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ShortcutAction {
    ToggleWindow,
    StartPause,
    Stop,
    NewItem,
}

/// 计时中换事项的模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SwitchMode {
    /// 结束当前会话（saved）并新开一条归属新事项的 active 会话（分段）。
    EndAndStart,
    /// 仅更改当前会话归属事项，时长连续不计断。
    JustSwitch,
}

/// 崩溃恢复对话框动作。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResolveAction {
    /// 保持 active，running_since 重置为 now（不计崩溃停机时长）。
    Resume,
    /// 置 saved，ended_at = endAt ?? now（不补算崩溃间隙）。
    Close,
    /// 软删除该会话（deleted_at=now 且 status='saved'），释放单 active 约束。
    Discard,
}

/// 计时器状态字符串值（`TimerState.status`）。
pub mod timer_status {
    pub const IDLE: &str = "idle";
    pub const RUNNING: &str = "running";
    pub const PAUSED: &str = "paused";
}

/// 计时模式字符串值（`TimeRecord.mode` / `TimerState.mode`；V0.2.0）。
pub mod timer_mode {
    pub const COUNTUP: &str = "countup";
    pub const COUNTDOWN: &str = "countdown";
}

/// 托盘菜单控制组状态（ADR-013 §6.e：空闲 / 计时中 / 倒计时中 / 暂停中四态裁剪）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TrayStatus {
    Idle,
    Running,
    /// [V0.2.0] 倒计时中（状态行含剩余时长）。
    Countdown,
    Paused,
}

impl TrayStatus {
    /// 由 `TimerState.status` 字符串解析（未知值按空闲处理；倒计时由快照另行覆盖）。
    pub fn from_timer_status(status: &str) -> Self {
        match status {
            timer_status::RUNNING => TrayStatus::Running,
            timer_status::PAUSED => TrayStatus::Paused,
            _ => TrayStatus::Idle,
        }
    }
}

/// 记录状态字符串值（`TimeRecord.status`；旧三态中的中间态已移除）。
pub mod record_status {
    pub const SAVED: &str = "saved";
}

/// 事项状态字符串值（`Item.status`）。
pub mod item_status {
    pub const ACTIVE: &str = "active";
    pub const ARCHIVED: &str = "archived";
}
