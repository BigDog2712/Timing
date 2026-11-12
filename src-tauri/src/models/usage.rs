//! 安卓应用使用统计的 DTO（0.13.0）。
//!
//! 两个方向各一套，字段名与 Kotlin 侧 `usageDay` 的回值逐字一致（`packageName` / `sec` /
//! `first` / `last`）—— 桥那层不做字段重命名，改名必须两边同批改。

use serde::{Deserialize, Serialize};

/// Kotlin `usageDay` 回的一行（JSON: `{packageName, sec, first, last}`）。
///
/// 桌面没有原生桥，`UsageDayReply` 不会被反序列化出来，于是这里会报 `dead_code`
/// （struct is never constructed）。**不 `cfg` 掉**：它是 Kotlin 回值的 DTO，与手机包
/// 逐字共用，`services::usage` 的纯逻辑签名也拿着它（`rollup(…, rows: &[UsageRowDto])`）；
/// `cfg` 掉之后两平台就得各写一份 DTO，字段名迟早分叉。
///
/// 编译器只保证这份 struct 自己前后一致，**它看不见 Kotlin**：改字段名不会有任何告警，
/// 对齐靠人去看 `UsageStats.kt` 的 `row.put(...)`。
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(desktop, allow(dead_code))]
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
///
/// 唯一的构造点是 `usage_stats_get` 的 `#[cfg(mobile)]` 分支（`bridge.call("usageDay")`
/// 反序列化），桌面只用到它的邻居 `UsageDay`。**不 `cfg` 掉**：它和手机包共用同一份
/// 定义，`cfg` 掉之后两平台就得各写一份 DTO，字段名迟早分叉。
///
/// **当前没有任何自动化判据**：仓库里没有断言 Rust 字段名与 Kotlin `usageDay` 回值一致的
/// 测试 —— `cargo test` 只验到这份 struct 编得过，编得过 ≠ 字段对得上；而且 `first` /
/// `last` / `granted` / `rows` 都带 `#[serde(default)]`，字段名改错了不报错，只静默读成
/// 0 / 空数组。对齐全靠人看：
/// `gen/android/…/com/timing/app/native/UsageStats.kt` 的 `row.put("packageName"/"sec"/
/// "first"/"last")`，以及 `com/timing/app/TimingNativePlugin.kt` 的 `payload.put("rows"/
/// "granted")`。改字段请两边同批改。
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(desktop, allow(dead_code))]
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
