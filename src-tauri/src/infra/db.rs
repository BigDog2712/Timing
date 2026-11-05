//! SQLite 连接池与迁移入口。
//!
//! DB 路径：`<app_data_dir>/<库文件名>`（WAL + 外键）。库文件名是**单一常量**
//! `infra::appdata_migrate::paths::DB_NAME`——它同时被迁移映射、诊断快照与本文件使用，
//! 改名时只要改那一处（PRD L2-2）。
//! 迁移实现见 `infra/migrate.rs`（0001 → 列守卫 → 0002 → 版本推进，全程幂等，K-13）。

use std::path::{Path, PathBuf};

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::infra::appdata_migrate::paths::{DB_NAME, LEGACY_DB_NAME};
use crate::infra::migrate;

/// 解析 `app_data_dir` 下真正的库文件路径。
///
/// 兜底规则（PRD §4.3 L2-2，**一次性**）：当前库名不存在、但同目录有老库名 →
/// 用老库并打一条 WARN。它兜的是「迁移没跑成 / 用户手工把老库拷进来」这类残局，
/// 让用户至少能打开自己的数据，而不是看到一个空库。
///
/// 阶段一（identifier 未变、库名也未变）时两个名字相同，本函数恒等于
/// `app_data_dir.join(DB_NAME)`；阶段二改库名后兜底才真正生效。
pub fn resolve_db_path(app_data_dir: &Path) -> PathBuf {
    let current = app_data_dir.join(DB_NAME);
    if current.exists() || DB_NAME == LEGACY_DB_NAME {
        return current;
    }
    let legacy = app_data_dir.join(LEGACY_DB_NAME);
    if legacy.exists() {
        crate::log_warn!(
            "database: {} 不存在，回退使用旧库名 {}（一次性兜底，见 PRD L2-2）",
            current.display(),
            legacy.display()
        );
        return legacy;
    }
    current
}

/// 建库（若缺）+ 执行全部迁移（v1 → v2），返回连接池。
pub async fn init_pool(app_data_dir: &Path) -> AppResult<SqlitePool> {
    std::fs::create_dir_all(app_data_dir)?;
    let db_path = resolve_db_path(app_data_dir);

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
