//! 提醒域 DTO（`reminder_*` 命令入参 / 出参 / `reminder-fired` 事件载荷）。
//!
//! 字段与 `src/types/domain-v020.ts` 的 `Reminder` / `ReminderTarget` 一一对应。

use serde::{Deserialize, Serialize};

/// 提醒目标类型（事项 / 待办）。字符串值 `snake_case`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ReminderTarget {
    Item,
    Todo,
}

impl ReminderTarget {
    /// 目标类型对应的表名（内部使用，非用户输入）。
    pub const fn table(self) -> &'static str {
        match self {
            ReminderTarget::Item => "items",
            ReminderTarget::Todo => "todos",
        }
    }

    /// 目标标题列名（`items.name` / `todos.title`）。
    pub const fn title_col(self) -> &'static str {
        match self {
            ReminderTarget::Item => "name",
            ReminderTarget::Todo => "title",
        }
    }
}

/// 提醒视图对象（`reminder_pending` 列表项 / `reminder_set` 返回 / 事件载荷）。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub target: ReminderTarget,
    pub target_id: i64,
    /// 目标标题（事项名或待办标题，供展示）。
    pub title: String,
    /// 提醒时刻（epoch 毫秒）。
    pub remind_at: i64,
}
