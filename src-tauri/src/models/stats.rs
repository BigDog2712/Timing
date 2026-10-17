//! 统计汇总 DTO（`stats_summary` 返回）。

use serde::Serialize;

/// 单事项聚合统计项。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub item_id: i64,
    pub total_sec: i64,
}

/// 汇总统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub total_sec: i64,
    pub record_count: i64,
    pub by_item: Vec<ItemStats>,
}
