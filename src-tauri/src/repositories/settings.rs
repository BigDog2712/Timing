//! 设置仓库（settings 键值表）。

use std::collections::HashMap;

use sqlx::SqlitePool;

use crate::error::AppResult;

/// 读取单键值。
pub async fn get_value(pool: &SqlitePool, key: &str) -> AppResult<Option<String>> {
    let value: Option<String> = sqlx::query_scalar("SELECT value FROM settings WHERE key = ?")
        .bind(key)
        .fetch_optional(pool)
        .await?;
    Ok(value)
}

/// 写入（upsert）单键值。
pub async fn set_value(pool: &SqlitePool, key: &str, value: &str, now: i64) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?) \
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
    )
    .bind(key)
    .bind(value)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

/// 读取全部键值。
pub async fn get_all(pool: &SqlitePool) -> AppResult<HashMap<String, String>> {
    let rows: Vec<(String, String)> = sqlx::query_as("SELECT key, value FROM settings")
        .fetch_all(pool)
        .await?;
    Ok(rows.into_iter().collect())
}
