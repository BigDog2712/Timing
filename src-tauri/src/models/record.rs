//! 时间记录域 DTO。

use serde::{Deserialize, Serialize};

/// 时间记录（一次计时会话）。字段与 `domain.ts::TimeRecord` 一一对应。
#[derive(Debug, Clone, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct TimeRecord {
    pub id: i64,
    pub item_id: i64,
    /// "active" | "saved"
    pub status: String,
    pub started_at: i64,
    /// active 时为 null
    pub ended_at: Option<i64>,
    pub accumulated_sec: i64,
    /// 非 null = 当前计时段起点(epoch ms)；null = 暂停或已结束
    pub running_since: Option<i64>,
    pub note: Option<String>,
    /// [V0.2.0] 计时模式："countup" | "countdown"。
    pub mode: String,
    /// [V0.2.0] 倒计时目标秒数；仅 `mode='countdown'` 非空。
    pub target_sec: Option<i64>,
}

/// `update_record` 的部分更新字段。
#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RecordPatch {
    #[serde(default)]
    pub item_id: Option<i64>,
    #[serde(default)]
    pub started_at: Option<i64>,
    #[serde(default)]
    pub ended_at: Option<i64>,
    #[serde(default)]
    pub note: Option<String>,
}
