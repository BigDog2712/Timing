//! 待办提醒链路 DTO（`todo-nudge` 事件载荷 / ADR-030）。
//!
//! 与 `src/types/domain-v020.ts::TodoNudge` 一一对应（serde `camelCase`）。
//! 两级提醒共用同一个载荷，靠 `stage` 区分：
//!   - `stage = 1`：开始前 15 分钟的**轻提醒**（问要不要改时间）；
//!   - `stage = 2`：开始前 5 分钟的**自动开始询问**（当前事项结束后自动开始？）。

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TodoNudge {
    pub todo_id: i64,
    /// 待办标题（浮出卡标题）
    pub title: String,
    /// 待办的开始时刻（epoch 毫秒；即 `todos.remind_at`）
    pub remind_at: i64,
    /// 1 = 轻提醒 / 2 = 自动开始询问
    pub stage: i64,
}
