//! 迁移可见性 DTO（V0.5.0 / ADR-037）：`get_migration_info` 的返回体。
//!
//! 字段一律 camelCase，与 `src/types/domain/migration.ts` 逐字对齐
//! （`check:contract` 只比对命令名，字段名靠这里与 TS 双侧 review 保证）。
//!
//! 为什么单独开一个模块而不是塞进 `Settings`：`Settings` 是业务配置的 KV 快照，
//! 迁移来源是**启动期一次性的运行事实**（写在标记文件里），两者的生命周期与
//! 失效条件不同。塞进 `Settings` 属于一次「门禁看不见的契约变更」——见 ADR-037。

use serde::{Deserialize, Serialize};

/// 五张关键表的行数快照（迁移校验与展示共用同一形状）。
///
/// 与 `migrations/0001~0004.sql` 的表名一一对应；少一张表就说明库结构不对，
/// `verify` 会把它当失败（而不是「0 行」蒙混过去）。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RowCounts {
    pub items: i64,
    pub time_records: i64,
    pub todos: i64,
    pub notes: i64,
    pub settings: i64,
}

impl RowCounts {
    /// 一行紧凑摘要，用于日志（`platform/log.rs` 口径，可 grep）。
    ///
    /// 形如 `items:8,records:512,todos:20,notes:3,settings:14`。
    pub fn summary(&self) -> String {
        format!(
            "items:{},records:{},todos:{},notes:{},settings:{}",
            self.items, self.time_records, self.todos, self.notes, self.settings
        )
    }
}

/// 当前数据从哪来（前端据此渲染 5 种文案）。
///
/// 线缆值由 `#[serde(rename_all = "lowercase")]` 决定（`legacy` / `fresh` / `pending` /
/// `unattached` / `skipped`），与 `src/types/domain/migration.ts` 的联合类型逐字一致。
/// **刻意不额外实现 `as_str()`**：那会是「序列化口径」的第二个副本，且当前没有任何
/// 调用方——`-D warnings` 下未使用的 `pub fn` 会直接判死码。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MigrationSource {
    /// 已从旧版本目录迁移成功（存在标记文件）
    Legacy,
    /// 全新数据（目标无库、旧目录也没东西）
    Fresh,
    /// 旧数据待迁移：上次用户选了「以空白数据启动」
    Pending,
    /// 目标已有库，但旧目录里还有没被采用的数据
    Unattached,
    /// 本次进程跳过了迁移（开发模式 / `TIMING_SKIP_MIGRATE=1`）
    Skipped,
}

/// `get_migration_info` 的返回体：只读、幂等、无副作用。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MigrationInfo {
    /// 数据来源判定（见 `MigrationSource`）
    pub source: MigrationSource,
    /// 迁移完成时间（本地时区 ISO8601 带偏移）；仅 `legacy` 有值
    pub migrated_at: Option<String>,
    /// 迁移当时的应用版本（如实反映「用哪个版本搬的」）
    pub app_version_at_migration: Option<String>,
    /// 旧数据目录绝对路径（**仅供展示**；`open_legacy_dir` 一律重算，不读它）
    pub legacy_dir: Option<String>,
    /// 旧数据目录当前是否还在
    pub legacy_exists: bool,
    /// 迁移时的库文件字节数
    pub db_bytes: Option<u64>,
    /// 迁移时的五表行数
    pub row_counts: Option<RowCounts>,
}
