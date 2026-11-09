//! 悬浮条（手机端）的显示快照 —— Rust → Kotlin 推送的唯一载荷（[V0.11.27]）。
//!
//! ## 为什么不再让原生层读库
//!
//! v0.11.22 的悬浮条由 `TimerReader.kt` 直接 `SELECT` 库里的 active 会话。那条路有两个
//! 已发生的问题：
//!
//! 1. **读不到时没有任何反馈**：路径不对 / open 被拒 / 列缺失，原生层只能落一个待机态，
//!    用户看到的是「主界面在计时，悬浮条不动」，而现场一个字都留不下来（v0.11.22 已踩）。
//! 2. **库是给业务用的，不是给显示用的**：悬浮条要的是「现在在跑什么、已经多久」，
//!    这是**状态机算出来的**，不是库里某一行的字面值（暂停时 `running_since` 是 null、
//!    倒计时要显示剩余而不是已用）。
//!
//! 所以显示源改成：计时状态每次迁移 → 这里组装一份快照 → 推到 Kotlin。原生侧从此不再
//! 需要理解库，也就不会出现两份口径。**原生仍然不写任何计时状态**（这条没变）。
//!
//! ## 为什么纯函数在这一层
//!
//! `of()` 不做 IO、不碰平台，桌面目标的 `cargo test` 就能验它——判据不能藏在
//! `#[cfg(mobile)]` 里（本项目第五次踩这条）。

use serde::Serialize;

use crate::models::enums::{timer_mode, timer_status};
use crate::models::timer::TimerState;

/// 悬浮条要显示的一屏所有信息。
///
/// 字段刻意用「原始值」而不是算好的显示串：`runningSince` 给原生层逐帧现算带小数的秒，
/// 圆点的弧才能连续扫过去；把秒数算死在 Rust 侧，悬浮条就只能每 500ms 跳一格。
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OverlaySnapshot {
    /// `idle` | `running` | `paused`
    pub status: String,
    /// 归属事项名；待机 / 事项已删为空串
    pub item: String,
    /// 已累计的整秒（**不含**本次 running 段）
    pub accumulated_sec: i64,
    /// 本次计时段起点（墙钟毫秒）；暂停 / 待机为 `null`
    pub running_since: Option<i64>,
    /// `countup` | `countdown`
    pub mode: String,
    /// 倒计时目标秒；正计时 / 待机为 0
    pub target_sec: i64,
}

impl OverlaySnapshot {
    /// 待机快照（`status = idle`，其余清零）。
    pub fn idle() -> Self {
        Self {
            status: timer_status::IDLE.to_string(),
            item: String::new(),
            accumulated_sec: 0,
            running_since: None,
            mode: timer_mode::COUNTUP.to_string(),
            target_sec: 0,
        }
    }

    /// 从状态机快照 + 事项名组装。
    ///
    /// 两个刻意的口径：
    /// - `status` 取 `state.status` 而不是 `session` 的有无——暂停会话仍然有 `session`，
    ///   但显示上必须是「已暂停」；
    /// - 待机时**不**保留 `mode`：上一次可能是倒计时，待机却显示「倒计时 0」会让人以为
    ///   正在倒计时（`TimerState::idle` 也是这个口径）。
    pub fn of(state: &TimerState, item: &str) -> Self {
        let Some(record) = state.session.as_ref() else {
            return Self::idle();
        };
        Self {
            status: state.status.clone(),
            item: item.to_string(),
            accumulated_sec: record.accumulated_sec,
            running_since: record.running_since,
            mode: record.mode.clone(),
            target_sec: record.target_sec.unwrap_or(0),
        }
    }

    /// 日志用的一行摘要（用户报障时要能一眼看出推的是哪一版状态）。
    pub fn summary(&self) -> String {
        format!(
            "{} item={:?} acc={} since={:?} mode={} target={}",
            self.status,
            self.item,
            self.accumulated_sec,
            self.running_since,
            self.mode,
            self.target_sec
        )
    }
}
