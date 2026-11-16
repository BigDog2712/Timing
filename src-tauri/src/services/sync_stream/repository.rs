//! `sync_event_cursor` 表的 SQL 原语（增查改）。
//!
//! ## 职责边界
//!
//! - **只碰 SQL**：这张表是「从对端设备读到哪」的下载游标（架构设计 §1.2）。
//! - **不做编排**：什么时候读游标、折叠成功后什么时候推进游标，都在 T02 的
//!   `sync_stream/push.rs`（`push_new_events`）/ `pull.rs`（`pull_segments`）——
//!   本文件只提供原语。
//!
//! ## 语义
//!
//! `device_id` 是**对端**设备 id（12 位小写 hex）。下载 = 读「`op_id > last_op_id`」
//! 的行；重复拉同一分段由 `timer_ops.uid` 的唯一索引 upsert 兜住幂等（§1.2），
//! 所以这里的写只需幂等 upsert，不必自建去重。

use sqlx::{Row, SqlitePool};

use crate::error::{AppError, AppResult};

/// 下载游标：记录「从这台对端设备读到哪」（§3 `EventCursor`）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EventCursor {
    /// 对端设备 id（12 位小写 hex）。
    pub device_id: String,
    /// 已读到的最新 `op_id`。
    pub last_op_id: i64,
    /// 已读到的最新分段序号。
    pub last_seq: i64,
}

/// 读某台对端设备的游标；还没读过（首轮）时返回 `None`。
pub async fn get(pool: &SqlitePool, device_id: &str) -> AppResult<Option<EventCursor>> {
    let row = sqlx::query("SELECT last_op_id, last_seq FROM sync_event_cursor WHERE device_id = ?")
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

/// 写入 / 推进游标（幂等 upsert）。重复调用不会产生重复行。
pub async fn upsert(
    pool: &SqlitePool,
    device_id: &str,
    last_op_id: i64,
    last_seq: i64,
) -> AppResult<()> {
    let mut conn = pool.acquire().await.map_err(AppError::db)?;
    upsert_in(&mut conn, device_id, last_op_id, last_seq).await
}

/// [`upsert`] 的事务内版本：**游标必须和「这一段事件的应用结果」同事务落库**。
///
/// 分开写会有一个致命的中间态（评审 P1-2）：事件与物化已经写进去、游标没写 ——
/// 下一轮重拉同一段，`timer_ops.uid` 唯一索引让每条事件 `rows_affected = 0`，
/// 于是**谁都不会再被标 dirty**，折叠被跳过、游标却顺利推进：那部分会话的
/// `time_records` 永远停在半截状态，而且从此没有任何一轮会去修它。
pub async fn upsert_in(
    conn: &mut sqlx::SqliteConnection,
    device_id: &str,
    last_op_id: i64,
    last_seq: i64,
) -> AppResult<()> {
    sqlx::query(
        "INSERT INTO sync_event_cursor (device_id, last_op_id, last_seq)
         VALUES (?, ?, ?)
         ON CONFLICT(device_id) DO UPDATE SET
           last_op_id = excluded.last_op_id,
           last_seq   = excluded.last_seq",
    )
    .bind(device_id)
    .bind(last_op_id)
    .bind(last_seq)
    .execute(&mut *conn)
    .await
    .map_err(AppError::db)?;
    Ok(())
}
