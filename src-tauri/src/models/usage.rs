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

/// Kotlin `usageDay` 回的**展示元数据**一行（JSON: `{packageName, label, icon}`）。
///
/// 为什么不并进 `UsageRowDto`：那张表是与 `app_usage` 逐字对齐的**事实**
/// （包名/秒/首末，见迁移 `0008_v01300.sql` 的「不存显示名」），
/// 而这里的东西每次现查、不进库、可以变（改名换图标）。混在一起会让
/// 「rows 字段名必须与 Kotlin 一致」这条纪律失去边界。
///
/// `label` 与 `icon` 都允许空串 —— 空是「不知道」（包已卸载 / 取图标失败），
/// **不是**「没有名字」。前端只有一条回落规则：空就退回包名短名。
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(desktop, allow(dead_code))]
#[serde(rename_all = "camelCase")]
pub struct UsageAppDto {
    pub package_name: String,
    #[serde(default)]
    pub label: String,
    /// `data:image/webp;base64,…`（64px）。**不是文件路径** —— 桥只能传 JSON，
    /// 写文件再让 WebView 读要开 asset 协议与作用域，配错的表现是满屏空图标。
    #[serde(default)]
    pub icon: String,
}

/// Kotlin `usageDay` 的整包回值。
///
/// `granted` 是 Kotlin 侧**如实回读**的系统状态（`UsageStats.hasPermission`）。
///
/// 0.12.1 及以前这里被写死成 `true`，于是「没开权限」被说成「开了但今天没用手机」：
/// 宿主那条 `if !reply.granted → USAGE_PERMISSION_DENIED` 永不触发，界面上永远等不到
/// 「去系统设置打开」的按钮，只剩一片 0 分钟，零报错。**不要再用「未授权时不会走到这里」
/// 的假设**去简化这条判断 —— 那是成因本身。
///
/// 唯一的构造点是 `usage_stats_get` 的 `#[cfg(mobile)]` 分支（`bridge.call("usageDay")`
/// 反序列化），桌面只用到它的邻居 `UsageDay`。**不 `cfg` 掉**：它和手机包共用同一份
/// 定义，`cfg` 掉之后两平台就得各写一份 DTO，字段名迟早分叉。
///
/// **字段名没有自动化判据**：`rows` / `apps` / `granted` / `first` / `last` 全带
/// `#[serde(default)]`，Kotlin 那边改名不会有任何告警，只会静默读成空数组 / 0 ——
/// 编译器看不见 Kotlin。对齐全靠人看 `gen/android/…/TimingNativePlugin.kt` 的
/// `payload.put("rows"/"apps"/"granted")` 与 `native/AppMetadata.kt` 的
/// `row.put("packageName"/"label"/"icon")`。
/// （0.12.2 那个「读不到应用数据」就是这一层的邻居问题：字段名没错，但 `rows` 的
/// **装箱方式**错了，抛的是 `Not a primitive array`。跨桥的类型与字段同样没有编译期保护。）
#[derive(Debug, Clone, Deserialize)]
#[cfg_attr(desktop, allow(dead_code))]
pub struct UsageDayReply {
    #[serde(default)]
    pub granted: bool,
    #[serde(default)]
    pub rows: Vec<UsageRowDto>,
    #[serde(default)]
    pub apps: Vec<UsageAppDto>,
}

/// 一次查询的聚合结果，直接给界面。
///
/// `label` / `icon` 由 `services::usage::with_meta` 从桥回的 `apps` 合并进来；
/// 合并不到就留空串（前端回落），**不在这里编名字**。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageAggregate {
    pub package_name: String,
    pub sec: i64,
    pub first: i64,
    pub last: i64,
    pub label: String,
    pub icon: String,
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
