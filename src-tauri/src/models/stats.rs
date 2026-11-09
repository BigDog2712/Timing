//! 统计汇总 DTO（`stats_summary` 返回）。

use serde::Serialize;

/// 单事项聚合统计项。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ItemStats {
    pub item_id: i64,
    pub total_sec: i64,
}

/// 区间内的电脑活动片段（按应用聚合）。
///
/// 数据来自 Patina 的活动库（`sessions` 表，**只读**）。它回答的是「这段时间用户实际在
/// 用什么软件」，与 `time_records` 天然同轴——两边都是毫秒时间戳，可直接按区间对齐，
/// 不需要任何映射表。
///
/// 桌面独有：手机端没有 Patina 子系统，`activity` 恒为空数组（前端按空处理，不分支）。
#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct ActivitySlice {
    /// 应用显示名（`sessions.app_name`，Patina 侧已做清洗）。
    pub app: String,
    /// 可执行文件名，用于区分同名应用与图标查表。
    pub exe: String,
    /// 落在查询区间内的秒数——**已按区间裁剪**，不是会话原始时长。
    pub sec: i64,
    /// 该应用在区间内的会话条数（粗粒度活跃度，不做连续段合并）。
    pub samples: i64,
}

/// 汇总统计。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatsSummary {
    pub total_sec: i64,
    pub record_count: i64,
    pub by_item: Vec<ItemStats>,
    /// 同期电脑活动（按秒降序）。手机端与「Patina 库缺失」时为空数组。
    pub activity: Vec<ActivitySlice>,
}
