use sqlx::{Row, SqlitePool};

use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingUpload {
    pub seq: i64,
    pub max_op_id: i64,
    pub body: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventCursor {
    pub device_id: String,
    pub last_op_id: i64,
    pub last_seq: i64,
}

pub async fn get(
    pool: &SqlitePool,
    scope: &str,
    device_id: &str,
) -> AppResult<Option<EventCursor>> {
    let row = sqlx::query(
        "SELECT last_op_id, last_seq FROM sync_target_cursor WHERE scope = ? AND device_id = ?",
    )
    .bind(scope)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::db)?;
    Ok(row.map(|row| EventCursor {
        device_id: device_id.to_string(),
        last_op_id: row.get("last_op_id"),
        last_seq: row.get("last_seq"),
    }))
}

pub async fn pending_upload(
    pool: &SqlitePool,
    scope: &str,
    device_id: &str,
) -> AppResult<Option<PendingUpload>> {
    let row = sqlx::query(
        "SELECT seq, max_op_id, body FROM sync_target_outbox WHERE scope = ? AND device_id = ?",
    )
    .bind(scope)
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::db)?;
    Ok(row.map(|row| PendingUpload {
        seq: row.get("seq"),
        max_op_id: row.get("max_op_id"),
        body: row.get("body"),
    }))
}

pub async fn stage_upload(
    pool: &SqlitePool,
    scope: &str,
    device_id: &str,
    seq: i64,
    max_op_id: i64,
    body: &[u8],
) -> AppResult<PendingUpload> {
    let mut tx = pool.begin().await.map_err(AppError::db)?;
    sqlx::query("INSERT OR IGNORE INTO sync_target_outbox (scope, device_id, seq, max_op_id, body) VALUES (?, ?, ?, ?, ?)")
        .bind(scope).bind(device_id).bind(seq).bind(max_op_id).bind(body).execute(&mut *tx).await.map_err(AppError::db)?;
    let row = sqlx::query(
        "SELECT seq, max_op_id, body FROM sync_target_outbox WHERE scope = ? AND device_id = ?",
    )
    .bind(scope)
    .bind(device_id)
    .fetch_one(&mut *tx)
    .await
    .map_err(AppError::db)?;
    tx.commit().await.map_err(AppError::db)?;
    Ok(PendingUpload {
        seq: row.get("seq"),
        max_op_id: row.get("max_op_id"),
        body: row.get("body"),
    })
}

pub async fn confirm_upload(
    pool: &SqlitePool,
    scope: &str,
    device_id: &str,
    batch: &PendingUpload,
) -> AppResult<()> {
    let mut tx = pool.begin().await.map_err(AppError::db)?;
    let deleted = sqlx::query("DELETE FROM sync_target_outbox WHERE scope = ? AND device_id = ? AND seq = ? AND max_op_id = ? AND body = ?")
        .bind(scope).bind(device_id).bind(batch.seq).bind(batch.max_op_id).bind(&batch.body)
        .execute(&mut *tx).await.map_err(AppError::db)?;
    // 迟到的重复确认不能倒退进度，也不能确认另一个批次。
    if deleted.rows_affected() != 0 {
        upsert_in(&mut tx, scope, device_id, batch.max_op_id, batch.seq).await?;
    }
    tx.commit().await.map_err(AppError::db)
}

pub async fn upsert(
    pool: &SqlitePool,
    scope: &str,
    device_id: &str,
    last_op_id: i64,
    last_seq: i64,
) -> AppResult<()> {
    let mut conn = pool.acquire().await.map_err(AppError::db)?;
    upsert_in(&mut conn, scope, device_id, last_op_id, last_seq).await
}

pub async fn upsert_in(
    conn: &mut sqlx::SqliteConnection,
    scope: &str,
    device_id: &str,
    last_op_id: i64,
    last_seq: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO sync_target_cursor (scope, device_id, last_op_id, last_seq)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(scope, device_id) DO UPDATE SET
           last_op_id = excluded.last_op_id,
           last_seq = excluded.last_seq",
    )
    .bind(scope)
    .bind(device_id)
    .bind(last_op_id)
    .bind(last_seq)
    .execute(&mut *conn)
    .await
    .map_err(AppError::db)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn failed_cursor_commit_keeps_the_exact_pending_batch() {
        let pool =
            crate::services::sync_stream::tests::pool_with_item_claimed_to("aaaaaaaaaaaa").await;
        let batch = stage_upload(&pool, "target-a", "aaaaaaaaaaaa", 1, 4, b"first")
            .await
            .unwrap();
        sqlx::query(
            "CREATE TRIGGER refuse_cursor BEFORE INSERT ON sync_target_cursor
            BEGIN SELECT RAISE(ABORT, 'injected cursor failure'); END",
        )
        .execute(&pool)
        .await
        .unwrap();
        assert!(confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &batch)
            .await
            .is_err());
        assert_eq!(
            pending_upload(&pool, "target-a", "aaaaaaaaaaaa")
                .await
                .unwrap(),
            Some(batch.clone())
        );
        assert!(get(&pool, "target-a", "aaaaaaaaaaaa")
            .await
            .unwrap()
            .is_none());
        sqlx::query("DROP TRIGGER refuse_cursor")
            .execute(&pool)
            .await
            .unwrap();
        confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &batch)
            .await
            .unwrap();
        assert!(pending_upload(&pool, "target-a", "aaaaaaaaaaaa")
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            get(&pool, "target-a", "aaaaaaaaaaaa")
                .await
                .unwrap()
                .unwrap()
                .last_op_id,
            4
        );
    }

    #[tokio::test]
    async fn late_confirmation_cannot_rewind_or_clear_a_new_batch() {
        let pool =
            crate::services::sync_stream::tests::pool_with_item_claimed_to("aaaaaaaaaaaa").await;
        let first = stage_upload(&pool, "target-a", "aaaaaaaaaaaa", 1, 4, b"first")
            .await
            .unwrap();
        confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &first)
            .await
            .unwrap();
        let next = stage_upload(&pool, "target-a", "aaaaaaaaaaaa", 2, 8, b"next")
            .await
            .unwrap();
        confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &first)
            .await
            .unwrap();
        assert_eq!(
            pending_upload(&pool, "target-a", "aaaaaaaaaaaa")
                .await
                .unwrap(),
            Some(next.clone())
        );
        confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &next)
            .await
            .unwrap();
        confirm_upload(&pool, "target-a", "aaaaaaaaaaaa", &first)
            .await
            .unwrap();
        assert_eq!(
            get(&pool, "target-a", "aaaaaaaaaaaa")
                .await
                .unwrap()
                .unwrap()
                .last_seq,
            2
        );
    }
}
