//! SQLite 连接池与迁移入口。
//!
//! DB 路径：`%APPDATA%\com.timing.app\timing.db`（WAL + 外键）。
//! 迁移实现见 `infra/migrate.rs`（0001 → 列守卫 → 0002 → 版本推进，全程幂等，K-13）。

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::migrate;

/// 建库（若缺）+ 执行全部迁移（v1 → v2），返回连接池。
pub async fn init_pool(app_data_dir: &Path) -> AppResult<SqlitePool> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = app_data_dir.join("timing.db");

    let options = SqliteConnectOptions::new()
        .filename(&db_path)
        .create_if_missing(true)
        .journal_mode(SqliteJournalMode::Wal)
        .foreign_keys(true);

    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .map_err(AppError::db)?;

    migrate::migrate(&pool).await?;

    Ok(pool)
}
