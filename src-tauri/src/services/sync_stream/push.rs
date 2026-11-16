//! 上传半轮：把本机 `op_id > 上传游标` 的新事件写成一个不可变分段并 PUT（If-None-Match）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::repositories::timer_ops as repo;
use crate::services::timer_ops::TimerOp;

use super::repository;
use super::segment::{encode_segment, segment_path};
use super::transport::Transport;
use super::PushSummary;

/// 上传：把本机 `op_id > 上传游标` 的新事件写成一个不可变分段并 PUT（If-None-Match）。
///
/// `device_id` 是本机身份；为空（身份没认领）时静默跳过——事件本就没有 uid，传不出去。
pub async fn push_new_events(
    pool: &SqlitePool,
    transport: &Transport,
    device_id: &str,
) -> AppResult<PushSummary> {
    let mut summary = PushSummary::default();
    if device_id.trim().is_empty() {
        return Ok(summary);
    }

    /* 上传游标 = `sync_event_cursor` 里 key 为本机 device_id 的那一行。 */
    let cursor = repository::get(pool, device_id).await?;
    let last_op_id = cursor.as_ref().map(|c| c.last_op_id).unwrap_or(0);
    let last_seq = cursor.as_ref().map(|c| c.last_seq).unwrap_or(0);

    let ops = load_new_ops(pool, device_id, last_op_id).await?;
    if ops.is_empty() {
        return Ok(summary);
    }

    let seq = (last_seq as u32).saturating_add(1);
    let rel = segment_path(device_id, seq);
    let body = encode_segment(&ops);
    let max_op_id = ops.iter().map(|op| op.op_id).max().unwrap_or(last_op_id);

    /* 「已存在」**不等于**「这批事件已经在了」。
     *
     * seq 是从游标推出来的：进程在 PUT 成功之后、游标落库之前被杀，下一轮会把
     * `id > 旧游标` 的事件重新取一遍（这一批**更长**），算出同一个 seq。此时
     * `put_if_absent` 返回「已存在」，若直接推进游标，中间那批事件就永久不会到对端。
     * 所以只有远端内容与本次批次**逐字节相同**才允许推进；不同就报错重试。 */
    let committed = match transport.put_if_absent(&rel, body.as_bytes()).await {
        Ok(true) => true,
        Ok(false) => match transport.get(&rel).await {
            Ok(Some(existing)) if existing == body.as_bytes() => true,
            Ok(Some(_)) => {
                summary.errors.push(format!(
                    "分段 {rel} 已存在且内容与本次批次不同：游标不推进，下一轮重试"
                ));
                crate::log_warn!("sync stream push: {rel} exists with different content");
                false
            }
            Ok(None) => {
                summary.errors.push(format!(
                    "分段 {rel} 报告已存在但读不回来：游标不推进，下一轮重试"
                ));
                false
            }
            Err(err) => {
                summary.errors.push(err);
                false
            }
        },
        Err(err) => {
            /* 传不上去只记错误、不折整轮（§7）：游标不动，下一轮重试这批事件。 */
            summary.errors.push(err);
            false
        }
    };

    if committed {
        repository::upsert(pool, device_id, max_op_id, seq as i64).await?;
        summary.segment_seq = seq;
        summary.events = ops.len();
        summary.bytes = body.len();
    }
    Ok(summary)
}

/// 查本机 `op_id > after_op_id` 且 uid 已发的新事件（按 id 升序，保证分段内顺序稳定）。
async fn load_new_ops(
    pool: &SqlitePool,
    device_id: &str,
    after_op_id: i64,
) -> AppResult<Vec<TimerOp>> {
    let rows = sqlx::query(
        "SELECT id, uid, session_uid, item_uid, kind, at_ms, payload, device_id
           FROM timer_ops
          WHERE id > ?1 AND device_id = ?2 AND uid IS NOT NULL
          ORDER BY id",
    )
    .bind(after_op_id)
    .bind(device_id)
    .fetch_all(pool)
    .await
    .map_err(AppError::db)?;
    Ok(rows.iter().filter_map(repo::to_op).collect())
}
