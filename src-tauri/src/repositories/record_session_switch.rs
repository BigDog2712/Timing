//! 「换事项即分段」的两条写入口：事务内版本供 `services::timer::switch` 与事件同事务，
//! 池版本保留给既有调用点。从 `record_session.rs` 拆出（那里的 300 行硬限已贴线）。

use sqlx::SqliteConnection;
#[cfg(test)]
use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};

/// 分段换事项：事务内结束旧会话并新开一条 active，返回新 id。
///
/// `discard_old = true` 时旧会话按**软删**处理（`deleted_at` 落盘、不联动待办）：
/// 调用方判定旧段短于「最短记录时长」，这段不该出现在记录列表里（ADR-023）。
/// 两条路径都写真实的 `accumulated_sec`——软删不等于可以留脏值。
pub(crate) async fn end_and_start_in(
    conn: &mut SqliteConnection,
    old_id: i64,
    new_item_id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
    discard_old: bool,
) -> AppResult<i64> {
    let deleted_at: Option<i64> = if discard_old { Some(now) } else { None };
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, \
             deleted_at = ?, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(deleted_at)
    .bind(now)
    .bind(old_id)
    .execute(&mut *conn)
    .await?;
    if saved.rows_affected() != 1 {
        // 旧会话已不在 active（并发结束）：不要用新分段掩盖掉这次失败
        return Err(AppError::timer_not_running());
    }
    if !discard_old {
        super::todo::soft_delete_for_saved_record(&mut *conn, old_id, now).await?;
    }
    let new_id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at, device_id) \
         VALUES (?, 'active', ?, NULL, 0, ?, ?, ?, ?) RETURNING id",
    )
    .bind(new_item_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(crate::services::identity::install_id().unwrap_or_default())
    .fetch_one(&mut *conn)
    .await?;
    Ok(new_id)
}

/// 池版本：自己开一个事务再委托 [`end_and_start_in`]。
///
/// 只给测试用（生产路径必须带着事件写，走 [`end_and_start_in`]）；
/// 挂 `cfg(test)` 是为了别在非测试构建里留下「定义了没人用」的告警。
#[cfg(test)]
pub async fn end_and_start(
    pool: &SqlitePool,
    old_id: i64,
    new_item_id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
    discard_old: bool,
) -> AppResult<i64> {
    let mut tx = pool.begin().await?;
    let new_id = end_and_start_in(
        &mut tx,
        old_id,
        new_item_id,
        accumulated_sec,
        ended_at,
        now,
        discard_old,
    )
    .await?;
    tx.commit().await?;
    Ok(new_id)
}
