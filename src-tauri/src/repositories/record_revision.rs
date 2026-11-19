use sqlx::SqliteConnection;

use crate::error::{AppError, AppResult};
use crate::services::timer_ops::{RecordRevision, TimerOpKind};

pub(crate) async fn next_at(
    conn: &mut SqliteConnection,
    record_id: i64,
    now: i64,
) -> AppResult<i64> {
    let latest: Option<i64> = sqlx::query_scalar(
        "SELECT MAX(at_ms) FROM timer_ops WHERE session_uid = (SELECT uid FROM time_records WHERE id = ?1)",
    )
    .bind(record_id)
    .fetch_one(&mut *conn)
    .await?;
    Ok(latest.map_or(now, |at| now.max(at.saturating_add(1))))
}

pub(crate) async fn append_in(
    conn: &mut SqliteConnection,
    record_id: i64,
    now: i64,
) -> AppResult<()> {
    let Some(device_id) = crate::services::identity::install_id() else {
        return Ok(());
    };
    let session: Option<Option<String>> =
        sqlx::query_scalar("SELECT uid FROM time_records WHERE id = ?1 AND status = 'saved'")
            .bind(record_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some(Some(session_uid)) = session else {
        return Ok(());
    };
    let revision: RecordRevision = sqlx::query_as(
        "SELECT r.device_id, i.uid AS item_uid, r.started_at, r.ended_at, r.accumulated_sec,
                r.note, r.mode, r.target_sec, r.deleted_at
           FROM time_records r JOIN items i ON i.id = r.item_id WHERE r.id = ?1",
    )
    .bind(record_id)
    .fetch_one(&mut *conn)
    .await?;
    let at_ms = next_at(
        conn,
        record_id,
        now.max(revision.ended_at.saturating_add(1)),
    )
    .await?;
    let day_key =
        crate::services::identity::local_day_key(revision.started_at).map_err(AppError::db)?;
    super::timer_ops_event::insert_op(
        conn,
        &super::timer_ops_event::NewOp {
            session_uid: &session_uid,
            item_uid: &revision.item_uid,
            kind: TimerOpKind::Adjust,
            at_ms,
            day_key: &day_key,
            payload: Some(&revision.payload()),
            device_id,
        },
    )
    .await?;
    Ok(())
}
