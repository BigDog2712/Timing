//! 下载半轮：发现对端设备 → 逐台 GET 顺号探测分段 → 解析 → 折叠物化 → 推进游标。

use sqlx::SqlitePool;

use crate::error::AppResult;

use super::apply::apply_and_fold;
use super::repository;
use super::segment::{decode_segment, segment_path};
use super::transport::Transport;
use super::PullSummary;

/// 下载：发现对端设备 → 逐台 GET 顺号探测分段 → 解析 → [`apply_and_fold`] → 推进游标。
///
/// `device_id` 是本机身份：列举 `sync/events/` 时把自己的目录跳过（自己不 pull 自己）。
pub async fn pull_segments(
    pool: &SqlitePool,
    transport: &Transport,
    device_id: &str,
) -> AppResult<PullSummary> {
    let mut summary = PullSummary::default();
    if device_id.trim().is_empty() {
        return Ok(summary);
    }

    let children = match transport.list_children("sync/events").await {
        Ok(names) => names,
        Err(err) => {
            summary.errors.push(err);
            return Ok(summary);
        }
    };
    let peers: Vec<String> = children
        .into_iter()
        .filter(|name| name != device_id)
        .collect();
    summary.peers = peers.len();

    for peer in peers {
        let cursor = repository::get(pool, &peer).await?;
        let last_op_id = cursor.as_ref().map(|c| c.last_op_id).unwrap_or(0);
        let last_seq = cursor.as_ref().map(|c| c.last_seq).unwrap_or(0);
        let mut max_op_id = last_op_id;
        let mut max_seq = last_seq;

        /* GET 顺号探测：seq 稠密单调，读到 404 即追平（见模块头）。 */
        let mut seq = last_seq.saturating_add(1);
        loop {
            let rel = segment_path(&peer, seq as u32);
            match transport.get(&rel).await {
                Ok(Some(bytes)) => {
                    summary.segments += 1;
                    match decode_segment(&bytes) {
                        Ok(ops) => {
                            summary.events += ops.len();
                            let outcome = apply_and_fold(pool, &ops).await?;
                            summary.applied += outcome.applied;
                            for op in &ops {
                                max_op_id = max_op_id.max(op.op_id);
                            }
                        }
                        Err(err) => summary.errors.push(format!("分段 {rel} 解析失败：{err}")),
                    }
                    max_seq = seq;
                    seq = seq.saturating_add(1);
                }
                Ok(None) => break,
                Err(err) => {
                    summary.errors.push(err);
                    break;
                }
            }
        }

        /* 有进展才写游标：max_seq 仍是旧值说明这台设备一个新分段都没读到。 */
        if max_seq > last_seq {
            repository::upsert(pool, &peer, max_op_id, max_seq).await?;
        }
    }
    Ok(summary)
}
