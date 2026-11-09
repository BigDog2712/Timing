use crate::patina::domain::backup::BackupIconCache;
use sqlx::{Pool, Row, Sqlite, Transaction};
use std::sync::Arc;
mod lifecycle;
pub(crate) use lifecycle::acquire_icon_cache_maintenance;

#[derive(Debug, serde::Serialize, sqlx::FromRow)]
pub struct ExecutableIconRow {
    pub exe_name: String,
    pub icon_base64: String,
}

pub async fn load_executable_icons(
    pool: &Pool<Sqlite>,
    exe_names: &[String],
) -> Result<Vec<ExecutableIconRow>, sqlx::Error> {
    if exe_names.len() > 900 {
        return Err(sqlx::Error::Protocol(
            "icon batch exceeds 900 executables".into(),
        ));
    }
    if exe_names.is_empty() {
        return Ok(vec![]);
    }
    let mut query = sqlx::QueryBuilder::<Sqlite>::new(
        "SELECT exe_name, icon_base64 FROM icon_cache WHERE LOWER(exe_name) IN (",
    );
    let mut values = query.separated(", ");
    for name in exe_names {
        values.push_bind(name.to_lowercase());
    }
    query.push(")");
    query.build_query_as().fetch_all(pool).await
}

// The case-sensitive primary key can cover name matching, then locate just one data row.
const ICON_CACHE_STATE_QUERY: &str = "SELECT last_updated FROM icon_cache WHERE exe_name = (
    SELECT exe_name FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1
)";

fn icon_payload(value: &str) -> &str {
    value
        .trim()
        .strip_prefix("data:image/png;base64,")
        .unwrap_or(value.trim())
}

pub(crate) struct IconCacheSnapshot {
    pub last_updated: Option<Option<i64>>,
    pool: Pool<Sqlite>,
    exe_name: String,
    epoch: u64,
    lifecycle: Arc<tokio::sync::Mutex<u64>>,
}

pub(crate) async fn read_icon_cache(
    pool: Pool<Sqlite>,
    exe_name: &str,
) -> Result<IconCacheSnapshot, sqlx::Error> {
    let lifecycle = lifecycle::state(&pool);
    let guard = lifecycle.lock().await;
    let epoch = *guard;
    let last_updated = sqlx::query_scalar::<_, Option<i64>>(ICON_CACHE_STATE_QUERY)
        .bind(exe_name.trim())
        .fetch_optional(&pool)
        .await?;
    drop(guard);
    Ok(IconCacheSnapshot {
        last_updated,
        pool,
        exe_name: exe_name.trim().into(),
        epoch,
        lifecycle,
    })
}

impl IconCacheSnapshot {
    pub async fn confirm(self, icon: &str, checked_at: i64) -> Result<bool, sqlx::Error> {
        // Keep the original pool: a restore must never redirect an old extraction into its replacement.
        let guard = self.lifecycle.lock().await;
        if self.epoch != *guard {
            return Ok(false);
        }
        let mut tx = self.pool.begin().await?;
        let current: Option<(String, Option<i64>)> = sqlx::query_as(
            "SELECT icon_base64, last_updated FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1",
        ).bind(&self.exe_name).fetch_optional(&mut *tx).await?;
        if current.as_ref().map(|(_, time)| *time) != self.last_updated {
            return Ok(false);
        }
        let changed = current
            .as_ref()
            .is_none_or(|(old, _)| icon_payload(old) != icon_payload(icon));
        if current.is_some() {
            if changed {
                sqlx::query("UPDATE icon_cache SET icon_base64 = ?, last_updated = ? WHERE exe_name = ? COLLATE NOCASE")
                    .bind(icon).bind(checked_at).bind(&self.exe_name).execute(&mut *tx).await?;
            } else {
                sqlx::query(
                    "UPDATE icon_cache SET last_updated = ? WHERE exe_name = ? COLLATE NOCASE",
                )
                .bind(checked_at)
                .bind(&self.exe_name)
                .execute(&mut *tx)
                .await?;
            }
        } else {
            sqlx::query(
                "INSERT INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
            )
            .bind(&self.exe_name)
            .bind(icon)
            .bind(checked_at)
            .execute(&mut *tx)
            .await?;
        }
        tx.commit().await?;
        Ok(changed)
    }
}

pub async fn fetch_icon_for_exe(
    pool: &Pool<Sqlite>,
    exe_name: &str,
) -> Result<Option<String>, String> {
    let trimmed = exe_name.trim();
    if trimmed.is_empty() {
        return Ok(None);
    }

    let row =
        sqlx::query("SELECT icon_base64 FROM icon_cache WHERE exe_name = ? COLLATE NOCASE LIMIT 1")
            .bind(trimmed)
            .fetch_optional(pool)
            .await
            .map_err(|error| format!("failed to read icon cache entry: {error}"))?;

    Ok(row.map(|row| row.get("icon_base64")))
}

pub async fn fetch_all_for_backup(pool: &Pool<Sqlite>) -> Result<Vec<BackupIconCache>, String> {
    let rows = sqlx::query("SELECT exe_name, icon_base64, last_updated FROM icon_cache")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to read icon cache for backup: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| BackupIconCache {
            exe_name: row.get("exe_name"),
            icon_base64: row.get("icon_base64"),
            last_updated: row.get("last_updated"),
        })
        .collect())
}

pub async fn insert_missing_for_restore(
    tx: &mut Transaction<'_, Sqlite>,
    icon_cache: &[BackupIconCache],
) -> Result<(), String> {
    for icon in icon_cache {
        sqlx::query(
            "INSERT OR IGNORE INTO icon_cache (exe_name, icon_base64, last_updated) VALUES (?, ?, ?)",
        )
        .bind(&icon.exe_name)
        .bind(&icon.icon_base64)
        .bind(icon.last_updated)
        .execute(&mut **tx)
        .await
        .map_err(|error| format!("failed to merge restore icon cache: {error}"))?;
    }

    Ok(())
}

#[cfg(test)]
#[path = "icon_cache_mod_tests.rs"]
mod tests;
