use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};

pub(super) async fn run(pool: &SqlitePool) -> AppResult<()> {
    let version: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'schema.version'")
            .fetch_optional(pool)
            .await
            .map_err(AppError::db)?;
    let version = version
        .and_then(|text| text.parse::<i64>().ok())
        .unwrap_or(0);
    if version < 15 {
        sqlx::raw_sql(include_str!("../../migrations/0015_v0151_sync_outbox.sql"))
            .execute(pool)
            .await
            .map_err(AppError::db)?;
    }
    if version < 16 {
        let mut tx = pool.begin().await.map_err(AppError::db)?;
        sqlx::raw_sql(include_str!("../../migrations/0016_sync_targets.sql"))
            .execute(&mut *tx)
            .await
            .map_err(AppError::db)?;
        tx.commit().await.map_err(AppError::db)?;
    }
    Ok(())
}
