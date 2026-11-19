//! 上传半轮：把本机 `op_id > 上传游标` 的新事件写成一个不可变分段并 PUT（If-None-Match）。

use sqlx::{Row, SqlitePool};

static PUSH_GATE: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

use crate::error::{AppError, AppResult};
use crate::repositories::timer_ops as repo;
use crate::services::timer_ops::TimerOp;

use super::repository;
use super::segment::encode_segment;
use super::transport::Transport;
use super::PushSummary;
use super::{scope, streams};

/// 上传：把本机 `op_id > 上传游标` 的新事件写成一个不可变分段并 PUT（If-None-Match）。
///
/// `device_id` 是本机身份；为空（身份没认领）时静默跳过——事件本就没有 uid，传不出去。
pub async fn push_new_events(
    pool: &SqlitePool,
    transport: &Transport,
    device_id: &str,
) -> AppResult<PushSummary> {
    // 手动、后台与保存入口共用闸门，避免确认后又写回同序号的旧批次。
    let _guard = PUSH_GATE.lock().await;
    push_with(pool, transport, device_id).await
}

async fn push_with(
    pool: &SqlitePool,
    transport: &Transport,
    device_id: &str,
) -> AppResult<PushSummary> {
    let mut summary = PushSummary::default();
    if device_id.trim().is_empty() {
        return Ok(summary);
    }

    if !crate::services::identity::is_valid(device_id) {
        summary
            .errors
            .push("本机设备身份无效，未写入同步目录".to_string());
        return Ok(summary);
    }
    let writer = match transport.scope() {
        Ok(scope) => scope,
        Err(err) => {
            summary.errors.push(err);
            return Ok(summary);
        }
    };
    let scope = scope::upload(&writer);
    let dir = streams::dir(device_id, &writer);
    let pending = match repository::pending_upload(pool, &scope, device_id).await? {
        Some(batch) => batch,
        None => {
            let cursor = repository::get(pool, &scope, device_id).await?;
            let last_op_id = cursor.as_ref().map(|c| c.last_op_id).unwrap_or(0);
            let last_seq = cursor.as_ref().map(|c| c.last_seq).unwrap_or(0);
            let ops = load_new_ops(pool, device_id, last_op_id).await?;
            let (offset, last_seq) = match super::recover_cursor::verified_prefix(
                pool, &scope, transport, device_id, &ops, last_seq, &dir,
            )
            .await
            {
                Ok(recovered) => recovered,
                Err(err) => {
                    summary.errors.push(err);
                    return Ok(summary);
                }
            };
            let ops = &ops[offset..];
            if ops.is_empty() {
                return Ok(summary);
            }
            let (count, body) = match bounded_payload(ops) {
                Ok(batch) => batch,
                Err(err) => {
                    summary.errors.push(err);
                    return Ok(summary);
                }
            };
            repository::stage_upload(
                pool,
                &scope,
                device_id,
                last_seq + 1,
                ops[count - 1].0,
                &body,
            )
            .await?
        }
    };
    let seq = match u32::try_from(pending.seq).ok().filter(|seq| *seq > 0) {
        Some(seq) => seq,
        None => {
            summary.errors.push("分段序号无效".to_string());
            return Ok(summary);
        }
    };
    let rel = streams::path(device_id, &writer, seq);
    let body = pending.body.as_slice();

    /* 已存在时只认同字节；不符则保留 outbox 并等待重试/人工处理。 */
    let committed = match transport.put_if_absent(&rel, body).await {
        Ok(true) => true,
        Ok(false) => match transport.get(&rel).await {
            Ok(Some(existing)) if existing == body => true,
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

    #[cfg(test)]
    if committed && super::transport::consume_fail_after_put() {
        return Ok(summary);
    }
    if committed {
        repository::confirm_upload(pool, &scope, device_id, &pending).await?;
        summary.segment_seq = seq;
        summary.events = super::segment::decode_segment(body)
            .map(|ops| ops.len())
            .unwrap_or(0);
        summary.bytes = body.len();
    }
    Ok(summary)
}

const MAX_BATCH_BYTES: usize = 1024 * 1024;

fn bounded_payload(ops: &[(i64, TimerOp)]) -> Result<(usize, Vec<u8>), String> {
    let mut size = 256;
    let mut payload = Vec::new();
    for (_, op) in ops {
        let bytes = serde_json::to_vec(op).expect("TimerOp 序列化不会失败");
        if size + bytes.len() + 1 > MAX_BATCH_BYTES {
            break;
        }
        size += bytes.len() + 1;
        payload.push(op.clone());
    }
    if payload.is_empty() {
        return Err("单条计时事件超过同步分段大小上限，未跳过事件".to_string());
    }
    Ok((payload.len(), encode_segment(&payload).into_bytes()))
}

/// 查本机 `op_id > after_op_id` 且 uid 已发的新事件（按 id 升序，保证分段内顺序稳定）。
async fn load_new_ops(
    pool: &SqlitePool,
    device_id: &str,
    after_op_id: i64,
) -> AppResult<Vec<(i64, TimerOp)>> {
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
    Ok(rows
        .iter()
        .filter_map(|row| repo::to_op(row).map(|op| (row.get("id"), op)))
        .collect())
}
