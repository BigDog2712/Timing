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

/// 按**键前缀**列出键（标签定义这类「成组 KV」用）。
///
/// 用 `substr(key, 1, length(?)) = ?` 而不是 `LIKE ?%`：标签路径里出现 `_` / `%`
/// 时 LIKE 的转义规则会静默匹配到别的键，而这里要的是逐字节前缀。
pub async fn list_keys_with_prefix(pool: &SqlitePool, prefix: &str) -> AppResult<Vec<String>> {
    let rows: Vec<String> = sqlx::query_scalar(
        "SELECT key FROM settings WHERE substr(key, 1, length(?)) = ? ORDER BY key ASC",
    )
    .bind(prefix)
    .bind(prefix)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// 删除单键（幂等：不存在不报错）。
pub async fn delete_key(pool: &SqlitePool, key: &str) -> AppResult<u64> {
    let result = sqlx::query("DELETE FROM settings WHERE key = ?")
        .bind(key)
        .execute(pool)
        .await?;
    Ok(result.rows_affected())
}
