//! 迁移执行器（幂等）：`0001_init` → `ensure_column`（列守卫）→ `0002_v020` → 版本推进。
//!
//! **K-13 硬约束**：SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，重复
//! `ADD COLUMN` 报 `duplicate column name`。故 items / time_records 的加列**不能**靠纯 SQL
//! 幂等，必须由 `ensure_column`（`PRAGMA table_info` 守卫）执行。
//!
//! **顺序是硬约束**：先补列，再执行 `0002_v020.sql` —— 后者建的 `idx_items_remind` 依赖
//! `items.remind_at`，旧库若先建索引会报 `no such column`（架构 §4.5）。

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

/// 执行全部迁移（幂等）。由 `infra::db::init_pool` 调用。
pub async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    // ① 3 张基表（IF NOT EXISTS，幂等）
    run_raw(pool, include_str!("../migrations/0001_init.sql")).await?;
    // ② 补列（必须早于建索引，K-13）
    for (table, column, def) in MIGRATE_COLUMNS {
        ensure_column(pool, table, column, def).await?;
    }
    // ③ 建 notes/todos + 全部 V0.2.0 索引 + settings 种子 + schema.version=2（幂等）
    run_raw(pool, include_str!("../migrations/0002_v020.sql")).await?;
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
