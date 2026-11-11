//! 安卓应用使用统计的 DTO（0.13.0）。
//!
//! 两个方向各一套，字段名与 Kotlin 侧 `usageDay` 的回值逐字一致（`packageName` / `sec` /
//! `first` / `last`）—— 桥那层不做字段重命名，改名必须两边同批改。

use serde::{Deserialize, Serialize};

/// Kotlin `usageDay` 回的一行（JSON: `{packageName, sec, first, last}`）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRowDto {
    pub package_name: String,
    pub sec: i64,
    #[serde(default)]
    pub first: i64,
    #[serde(default)]
    pub last: i64,
}

/// Kotlin `usageDay` 的整包回值。
///
/// `granted` 恒为 true（授权状态有单独的命令语义：未授权时 `usage_stats_get` 直接回
/// `USAGE_PERMISSION_DENIED`，不会走到这里）。保留字段是为了将来「部分授权」的 ROM。
#[derive(Debug, Clone, Deserialize)]
pub struct UsageDayReply {
    #[serde(default)]
    pub granted: bool,
    #[serde(default)]
    pub rows: Vec<UsageRowDto>,
}

/// 一次查询的聚合结果，直接给界面。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAggregate {
    pub package_name: String,
    pub sec: i64,
    pub first: i64,
    pub last: i64,
}

/// `usage_stats_get` 的回值。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageDay {
    /// 这个平台有没有「应用使用统计」这回事（桌面 = false，页面据此不显示入口）。
    pub supported: bool,
    pub date: String,
    pub total_sec: i64,
    pub rows: Vec<UsageAggregate>,
}
