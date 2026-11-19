//! 迁移登记表（`patina.db` 的 sqlx `Migrator` 源）。
//!
//! ## 为什么单独一个文件
//!
//! 登记表是**只增不改**的一段：历史版本（1–27）已经写进用户的 `_sqlx_migrations`
//! 账本，checksum 逐字节比对，任何"顺手整理"都会让老库报 checksum mismatch。
//! 而 `schema.rs` 里是**可改的** DDL 文本常量（新库建表用），两者生命周期完全不同，
//! 混在一个 1887 行的文件里会让「我只改一行 DDL」看起来像「我动了迁移」。
//!
//! 拆分还顺带守住单文件 ≤300 行的棘轮：`schema.rs` 正好压在冻结线上。
//!
//! ## 新迁移怎么加
//!
//! 1. DDL 正文写进 `data/sql/00NN_*.sql`（`.sql` 不受 `check:size` 约束，也不占 Rust 行数）；
//! 2. 这里追加一条 `Migration { version, description, sql: include_str!("sql/00NN_*.sql") }`；
//! 3. **不要**去 `schema_contracts::schema_revision_limit()` 里加新版本的探测项——
//!    加了会让老库被标成"已应用"而从不执行（见 `sqlite_pool.rs` 那段注释）。
//!
//! 顺序即执行顺序：`sqlx::Migration` 按 version 升序跑，本节必须保持升序。

use super::schema::*;

/// 设备维度迁移的版本号（`patina.db` 的 head）。
///
/// 之所以在这里定义而不是 `schema.rs`：它是**迁移登记**的事实，`sqlite_pool` 的
/// schema 巡检（`VALIDATED_SCHEMA_MIGRATION_HEAD`）要拿它对齐，两者必须同源。
pub const DEVICE_DIMENSION_MIGRATION_VERSION: i64 = 28;

/// 同步簿记迁移的版本号。
///
/// ⚠️ 与 28 一样：**不要**去 `schema_contracts::schema_revision_limit()` 里加它的探测项
/// （见该函数与本文件头注释）。
pub const SYNC_BOOKKEEPING_MIGRATION_VERSION: i64 = 29;

/// 事项归属迁移的版本号（当前 head）。
///
/// ⚠️ 同上：**不要**给 `schema_revision_limit()` 加 30 的探测项。
pub const ITEM_ATTRIBUTION_MIGRATION_VERSION: i64 = 30;

/// 设备维度迁移的正文。放 `.sql` 文件：`check:size` 不扫 `.sql`，而且 DDL 用 SQL 写
/// 比挤在 Rust 字符串里可读（多语句、注释、反引号都不用转义）。
pub const DEVICE_DIMENSION_SQL: &str = include_str!("sql/0028_device_dimension.sql");

/// 同步簿记（P4 · T11）的正文：`updated_at_ms` 盖戳、墓碑、四张同步表。
pub const SYNC_BOOKKEEPING_SQL: &str = include_str!("sql/0029_sync_bookkeeping.sql");

/// 事项归属的正文：`app_category` / `block_segment_override` / `focus_blocks`。
pub const ITEM_ATTRIBUTION_SQL: &str = include_str!("sql/0030_item_attribution.sql");

/// 媒体播放时间线的版本号（当前 head）。
///
/// ⚠️ 同上：**不要**给 `schema_revision_limit()` 加 31 的探测项。
pub const MEDIA_PLAYBACK_MIGRATION_VERSION: i64 = 31;

/// 媒体播放时间线的正文：`media_playback_samples` 只记系统媒体会话公开的标题/作者。
pub const MEDIA_PLAYBACK_SQL: &str = include_str!("sql/0031_media_playback.sql");

/// 登记表里的最大版本（= 当前 head）。
///
/// 给巡检与用例用。用例里写死数字会让每加一条迁移都要改好几处断言，而「改断言」正是
/// 最容易改错的地方（把 29 写成 28 照样绿）；真正该钉成常量的只有「这一轮是几」那一处。
pub fn head_version() -> i64 {
    tracker_migrations()
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default()
}

/// 全部迁移（升序）。
pub fn tracker_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: CURRENT_BASELINE_MIGRATION_VERSION,
            description: CURRENT_BASELINE_MIGRATION_DESCRIPTION,
            sql: CURRENT_BASELINE_SCHEMA_SQL,
        },
        Migration {
            version: TOOLS_TABLES_MIGRATION_VERSION,
            description: TOOLS_TABLES_MIGRATION_DESCRIPTION,
            sql: TOOLS_TABLES_SCHEMA_SQL,
        },
        Migration {
            version: SOFTWARE_REMINDER_RULES_MIGRATION_VERSION,
            description: SOFTWARE_REMINDER_RULES_MIGRATION_DESCRIPTION,
            sql: SOFTWARE_REMINDER_RULES_SCHEMA_SQL,
        },
        Migration {
            version: WEB_ACTIVITY_MIGRATION_VERSION,
            description: WEB_ACTIVITY_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_SCHEMA_SQL,
        },
        Migration {
            version: WEB_FAVICON_CACHE_MIGRATION_VERSION,
            description: WEB_FAVICON_CACHE_MIGRATION_DESCRIPTION,
            sql: WEB_FAVICON_CACHE_SCHEMA_SQL,
        },
        Migration {
            version: IMPORT_DATA_MIGRATION_VERSION,
            description: IMPORT_DATA_MIGRATION_DESCRIPTION,
            sql: IMPORT_DATA_SCHEMA_SQL,
        },
        Migration {
            version: IMPORT_DATA_ISOLATION_MIGRATION_VERSION,
            description: IMPORT_DATA_ISOLATION_MIGRATION_DESCRIPTION,
            sql: IMPORT_DATA_ISOLATION_SCHEMA_SQL,
        },
        Migration {
            version: ACTIVITY_READ_MODELS_MIGRATION_VERSION,
            description: ACTIVITY_READ_MODELS_MIGRATION_DESCRIPTION,
            sql: ACTIVITY_READ_MODELS_SCHEMA_SQL,
        },
        Migration {
            version: WEB_ACTIVITY_REVISION_MIGRATION_VERSION,
            description: WEB_ACTIVITY_REVISION_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_REVISION_SCHEMA_SQL,
        },
        Migration {
            version: SCHEDULED_BACKUP_MIGRATION_VERSION,
            description: SCHEDULED_BACKUP_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_BACKUP_SCHEMA_SQL,
        },
        Migration {
            version: SCHEDULED_BACKUP_TARGETS_MIGRATION_VERSION,
            description: SCHEDULED_BACKUP_TARGETS_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_BACKUP_TARGETS_SCHEMA_SQL,
        },
        Migration {
            version: SCHEDULED_EXPORT_MIGRATION_VERSION,
            description: SCHEDULED_EXPORT_MIGRATION_DESCRIPTION,
            sql: SCHEDULED_EXPORT_SCHEMA_SQL,
        },
        Migration {
            version: ACTIVITY_REMINDER_RULES_MIGRATION_VERSION,
            description: ACTIVITY_REMINDER_RULES_MIGRATION_DESCRIPTION,
            sql: ACTIVITY_REMINDER_RULES_SCHEMA_SQL,
        },
        Migration {
            version: WEB_ACTIVITY_SESSION_MIGRATION_VERSION,
            description: WEB_ACTIVITY_SESSION_MIGRATION_DESCRIPTION,
            sql: WEB_ACTIVITY_SESSION_SCHEMA_SQL,
        },
        Migration {
            version: SESSION_RANGE_INDEX_MIGRATION_VERSION,
            description: SESSION_RANGE_INDEX_MIGRATION_DESCRIPTION,
            sql: SESSION_RANGE_INDEX_SCHEMA_SQL,
        },
        Migration {
            version: ANONYMOUS_ACTIVITY_MIGRATION_VERSION,
            description: "create_anonymous_activity",
            sql: crate::services::activity::data::repositories::anonymous_activity::SCHEMA_SQL,
        },
        Migration {
            version: WIDGET_RETIREMENT_MIGRATION_VERSION,
            description: "retire_widget_preferences",
            sql: WIDGET_RETIREMENT_SQL,
        },
        Migration {
            version: ACTIVITY_REMINDER_EXTENSION_MIGRATION_VERSION,
            description: "extend_activity_reminders_for_today",
            sql: ACTIVITY_REMINDER_EXTENSION_SQL,
        },
        Migration {
            version: ACTIVITY_REMINDER_ENABLED_MIGRATION_VERSION,
            description: "persist_activity_reminder_enabled_state",
            sql: ACTIVITY_REMINDER_ENABLED_SQL,
        },
        Migration {
            version: REMINDER_RECURRENCE_MIGRATION_VERSION,
            description: "persist_reminder_recurrence",
            sql: REMINDER_RECURRENCE_SQL,
        },
        Migration {
            version: ACTIVITY_REMINDER_UNIQUE_TARGET_MIGRATION_VERSION,
            description: "unique_activity_reminder_targets",
            sql: ACTIVITY_REMINDER_UNIQUE_TARGET_SQL,
        },
        Migration {
            version: TIMER_RETIREMENT_MIGRATION_VERSION,
            description: "retire_tools_timer",
            sql: TIMER_RETIREMENT_SQL,
        },
        Migration {
            version: POMODORO_TASKS_MIGRATION_VERSION,
            description: "named pomodoro tasks",
            sql: POMODORO_TASKS_SQL,
        },
        Migration {
            version: POMODORO_COMPLETIONS_MIGRATION_VERSION,
            description: "count completed pomodoro groups",
            sql: POMODORO_COMPLETIONS_SQL,
        },
        Migration {
            version: FREE_FOCUS_MIGRATION_VERSION,
            description: "free focus with configurable breaks",
            sql: FREE_FOCUS_SQL,
        },
        Migration {
            version: REMINDER_IDENTITY_MIGRATION_VERSION,
            description: "stable timed reminder restore identity",
            sql: REMINDER_IDENTITY_SQL,
        },
        Migration {
            version: FOCUS_HISTORY_VERSION,
            description: "record focus task history",
            sql: include_str!("focus_history.sql"),
        },
        Migration {
            version: DEVICE_DIMENSION_MIGRATION_VERSION,
            description: "device_dimension",
            sql: DEVICE_DIMENSION_SQL,
        },
        Migration {
            version: SYNC_BOOKKEEPING_MIGRATION_VERSION,
            description: "sync_bookkeeping",
            sql: SYNC_BOOKKEEPING_SQL,
        },
        Migration {
            version: ITEM_ATTRIBUTION_MIGRATION_VERSION,
            description: "item_attribution",
            sql: ITEM_ATTRIBUTION_SQL,
        },
        Migration {
            version: MEDIA_PLAYBACK_MIGRATION_VERSION,
            description: "media_playback_timeline",
            sql: MEDIA_PLAYBACK_SQL,
        },
    ]
}
