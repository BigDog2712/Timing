//! 迁移执行器（幂等）：`0001_init` → 补列 → `0002_v020` → 补列(v3) → `0003_v030` → 版本推进。
//!
//! **K-13 硬约束**：SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，重复
//! `ADD COLUMN` 报 `duplicate column name`。故 items / time_records / notes 的加列**不能**
//! 靠纯 SQL 幂等，必须由 `ensure_column`（`PRAGMA table_info` 守卫）执行。
//!
//! **顺序是硬约束**：
//!   1. 先补 v2 列，再执行 `0002_v020.sql` —— 后者建的 `idx_items_remind` 依赖
//!      `items.remind_at`，旧库若先建索引会报 `no such column`（架构 §4.5）；
//!   2. 先执行 `0002_v020.sql` 建 `notes` 表，再补 `notes.is_pinned` —— 反过来
//!      `ALTER TABLE notes` 在 v1 库上会报 `no such table`。

use sqlx::{Row, SqlitePool};

use crate::error::{AppError, AppResult};

/// V0.2.0 加列清单 `(表, 列, 定义)`。定义与 `schema-V0.2.0.sql` 目标 DDL 对齐；
/// 旧库经 `ALTER` 补齐后**不带 CHECK**（SQLite 限制），取值由应用层保证（架构 §4.3）。
const MIGRATE_COLUMNS: &[(&str, &str, &str)] = &[
    ("items", "remind_at", "INTEGER"),
    ("items", "reminded_at", "INTEGER"),
    ("items", "is_pinned", "INTEGER NOT NULL DEFAULT 0"),
    ("time_records", "mode", "TEXT NOT NULL DEFAULT 'countup'"),
    ("time_records", "target_sec", "INTEGER"),
];

/// V0.3.0 加列清单。**必须晚于 `0002_v020.sql`**（`notes` 表由它创建）。
///
/// `DEFAULT 1` = 置顶：V0.2.x 的便利贴窗口硬编码 `always_on_top=true`，默认 1 让
/// 老数据升级后行为不变（ADR-019）。
const MIGRATE_COLUMNS_V3: &[(&str, &str, &str)] =
    &[("notes", "is_pinned", "INTEGER NOT NULL DEFAULT 1")];

/// V0.3.12 加列清单（待办提醒链路，ADR-030）。**必须晚于 `0002_v020.sql`**（`todos` 由它创建）。
///
/// - `remind_stage`：0 未提醒 / 1 轻提醒已弹 / 2 五分钟询问已弹（单调递进，替代单次 `reminded_at`）；
/// - `auto_start`：1 = 用户答应「当前事项结束后自动开始」。
const MIGRATE_COLUMNS_V4: &[(&str, &str, &str)] = &[
    ("todos", "remind_stage", "INTEGER NOT NULL DEFAULT 0"),
    ("todos", "auto_start", "INTEGER NOT NULL DEFAULT 0"),
];

/// 执行全部迁移（幂等）。由 `infra::db::init_pool` 调用。
pub async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    // ① 3 张基表（IF NOT EXISTS，幂等）
    run_raw(pool, include_str!("../migrations/0001_init.sql")).await?;
    // ② 补 v2 列（必须早于建索引，K-13）
    for (table, column, def) in MIGRATE_COLUMNS {
        ensure_column(pool, table, column, def).await?;
    }
    // ③ 建 notes/todos + 全部 V0.2.0 索引 + settings 种子 + schema.version=2（幂等）
    run_raw(pool, include_str!("../migrations/0002_v020.sql")).await?;
    // ④ 补 v3 列（必须在 notes 建好之后）
    for (table, column, def) in MIGRATE_COLUMNS_V3 {
        ensure_column(pool, table, column, def).await?;
    }
    // ⑤ v3 版本推进（schema.version=3）
    run_raw(pool, include_str!("../migrations/0003_v030.sql")).await?;
    // ⑥ 补 v4 列（待办提醒链路）
    for (table, column, def) in MIGRATE_COLUMNS_V4 {
        ensure_column(pool, table, column, def).await?;
    }
    // ⑦ v4 版本推进（schema.version=4）
    run_raw(pool, include_str!("../migrations/0004_v0312.sql")).await?;
    Ok(())
}

/// 仅当列不存在时执行 `ALTER TABLE ... ADD COLUMN`（幂等守卫）。
///
/// `table` / `column` / `def` 均取自本模块常量（非用户输入）；SQLite 的 DDL 不支持参数绑定。
pub async fn ensure_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    def: &str,
) -> AppResult<()> {
    if column_exists(pool, table, column).await? {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {def}");
    sqlx::query(&sql)
        .execute(pool)
        .await
        .map_err(AppError::db)?;
    Ok(())
}

/// 列是否存在（`PRAGMA table_info`）。
async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> AppResult<bool> {
    let sql = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(AppError::db)?;
    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == column))
}

/// 执行一段多语句 SQL。
async fn run_raw(pool: &SqlitePool, sql: &str) -> AppResult<()> {
    sqlx::raw_sql(sql)
        .execute(pool)
        .await
        .map_err(AppError::db)?;
    Ok(())
}
