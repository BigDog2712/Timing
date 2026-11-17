use std::path::Path;

const SCRUB_SQL: &str =
    "DELETE FROM settings WHERE key IN ('web_activity_token','remote_status_bridge_token')";

pub(super) async fn scrub_snapshot_secrets(path: &Path) -> Result<(), String> {
    let pool = crate::services::activity::data::sqlite_pool::open_single_connection_sqlite_pool(
        path, false,
    )
    .await?;
    let result = scrub_snapshot_secrets_from_pool(&pool).await;
    pool.close().await;
    result
}

pub(super) async fn scrub_snapshot_secrets_from_pool(
    candidate_pool: &sqlx::SqlitePool,
) -> Result<(), String> {
    sqlx::query(SCRUB_SQL)
        .execute(candidate_pool)
        .await
        .map(|_| ())
        .map_err(|error| format!("failed to scrub bridge credentials from snapshot: {error}"))
}
