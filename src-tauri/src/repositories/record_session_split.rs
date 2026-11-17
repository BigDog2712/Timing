//! 计时会话的结束与「跨零点拆分落库」。
//!
//! 从 `record_session.rs` 拆出（单文件 ≤300 行纪律，同 `timer.rs` 拆 `timer_stop` 的做法）：
//! `record_session::finalize` / `finalize_split` 在此 re-export，调用点写法不变。
//!
//! 两者是「结束一条会话」的两条路径：不跨天走 [`finalize`]（一次 UPDATE），
//! 跨天走 [`finalize_split`]（前面各段 INSERT + 最后一段复用原行 id）。

use sqlx::SqliteConnection;

use crate::error::{AppError, AppResult};
use crate::models::record::TimeRecord;

/// 结束会话：置 saved、冻结累计、ended_at 落盘。
///
/// 参数是**调用方的事务**而不是连接池（S3）：结束与 `stop` 事件必须一起落，
/// 分两次写会出现「本机保存了、对端还在跑」。
pub(crate) async fn finalize(
    conn: &mut SqliteConnection,
    id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
) -> AppResult<()> {
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    if saved.rows_affected() != 1 {
        /* 0 行说明会话已被别处结束（双击结束、并发 stop），不能让调用方以为保存成功。
           返回 Err 而不回滚：回滚是调用方事务的事（`finalize` 丢弃 tx 即回滚）。 */
        return Err(AppError::timer_not_running());
    }
    super::todo::soft_delete_for_saved_record(conn, id, now).await?;
    Ok(())
}

/// 跨零点分段落库（V0.11.3）：把一条 active 会话按给定分段切成多条 saved。
///
/// 参数是调用方的事务，理由同 [`finalize`]。
pub(crate) async fn finalize_split(
    conn: &mut SqliteConnection,
    active: &TimeRecord,
    segments: &[(i64, i64, i64)],
    now: i64,
) -> AppResult<()> {
    let Some(&(last_start, last_end, last_accum)) = segments.last() else {
        return Err(AppError::invalid_duration());
    };

    /* 拆出来的每一段都要带 device_id：uid（`t:<device>:<id>`）靠 AFTER INSERT 触发器按它发，
       漏写就是「这一段永远不同步」，而且零报错。 */
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    for (start, end, accum) in &segments[..segments.len() - 1] {
        let id: i64 = sqlx::query_scalar(
            "INSERT INTO time_records \
             (item_id, status, started_at, ended_at, accumulated_sec, running_since, \
              mode, target_sec, created_at, updated_at, device_id) \
             VALUES (?, 'saved', ?, ?, ?, NULL, ?, NULL, ?, ?, ?) RETURNING id",
        )
        .bind(active.item_id)
        .bind(start)
        .bind(end)
        .bind(accum)
        .bind(&active.mode)
        .bind(now)
        .bind(now)
        .bind(device_id)
        .fetch_one(&mut *conn)
        .await?;
        super::record_revision::append_in(conn, id, now).await?;
    }
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', started_at = ?, ended_at = ?, accumulated_sec = ?, \
             running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(last_start)
    .bind(last_end)
    .bind(last_accum)
    .bind(now)
    .bind(active.id)
    .execute(&mut *conn)
    .await?;
    if saved.rows_affected() != 1 {
        /* 与 `finalize` 同一口径：会话已被别处结束时不假装成功。 */
        return Err(AppError::timer_not_running());
    }
    super::todo::soft_delete_for_saved_record(conn, active.id, now).await?;
    super::record_revision::append_in(conn, active.id, now).await?;
    Ok(())
}
