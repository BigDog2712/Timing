//! 下载半轮：发现对端设备 → 逐台 GET 顺号探测分段 → 解析 → 折叠物化 → 推进游标。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::services::identity;

use super::apply::apply_and_fold;
use super::repository;
use super::segment::{decode_segment, format_seq, segment_dir};
use super::transport::Transport;
use super::PullSummary;
use super::{scope, streams};
use std::collections::BTreeSet;

/// 下载：发现对端设备 → 逐台 GET 顺号探测分段 → 解析 → [`apply_and_fold`] → 推进游标。
///
/// `device_id` 是本机身份：列举旧 `sync/events/` 与新 `sync/streams/` 时都跳过自己的目录。
pub async fn pull_segments(
    pool: &SqlitePool,
    transport: &Transport,
    device_id: &str,
) -> AppResult<PullSummary> {
    let mut summary = PullSummary::default();
    if device_id.trim().is_empty() {
        return Ok(summary);
    }

    let scope = match transport.scope() {
        Ok(scope) => scope,
        Err(err) => {
            summary.errors.push(err);
            return Ok(summary);
        }
    };
    let mut seen = BTreeSet::new();
    for root in ["sync/events", streams::ROOT] {
        let children = match transport.list_children(root).await {
            Ok(names) => names,
            Err(err) => {
                summary.errors.push(err);
                continue;
            }
        };
        for peer in peers_of(&children, device_id, root, &mut summary) {
            seen.insert(peer.clone());
            if root == "sync/events" {
                pull_one_peer(
                    pool,
                    transport,
                    &scope,
                    &peer,
                    &segment_dir(&peer),
                    &mut summary,
                )
                .await?;
                continue;
            }
            let writers = match transport.list_children(&format!("{root}/{peer}")).await {
                Ok(names) => names,
                Err(err) => {
                    summary.errors.push(err);
                    continue;
                }
            };
            for writer in writers {
                if !streams::valid_writer(&writer) {
                    summary.warnings.push(format!(
                        "同步目录 {root}/{peer} 里有无效写入流 {writer}：已跳过"
                    ));
                    continue;
                }
                let ledger = scope::download(&scope, &writer);
                pull_one_peer(
                    pool,
                    transport,
                    &ledger,
                    &peer,
                    &streams::dir(&peer, &writer),
                    &mut summary,
                )
                .await?;
            }
        }
    }
    summary.peers = seen.len();
    Ok(summary)
}

/// 从同步根目录的子项里挑出**合法**的对端设备目录。
///
/// 只收 [`identity::is_valid`] 认得的 12 位小写 hex（评审 P2-1）。原文直接把「名字不是
/// 本机」的项当 peer，再拿它拼 URL —— 名字里带 `?` / `#` 的目录会被按 query / fragment
/// 解释，拼出来的地址与真实目录不是同一份，于是那台设备**永远读不到**，而界面上只
/// 表现为「同步卡住了」。非法的项要能看见（用户能去清理那个目录），但**不能**影响其它
/// 设备继续同步。
///
/// ## 为什么记 `warnings` 而不是 `errors`（2026-11-16 真机）
///
/// `round_stream::run` 用「`errors` 是否为空」判整轮成败。原文把非法项推进 `errors`，
/// 于是**一个与同步无关的条目让整轮判失败**：坚果云的 PROPFIND 在该目录下稳定回一个
/// `unix-directory` 条目，实测每跑一轮就触发一次退避、退避时长翻倍，22:45 之后日志里
/// 只剩 `skip=backoff`，同步基本跑不动（0.12.11 真机）。
///
/// 「目录里有个杂项」是**看得见就行**的事，「本轮同步失败」是**要退避**的事，两者不能共用
/// 一个字段。杂项落 `warnings`，照旧点名，并且带上完整子项列表 —— 下次再冒出别的怪名字，
/// 日志里能直接看出它是从哪来的。
fn peers_of(
    children: &[String],
    device_id: &str,
    root: &str,
    summary: &mut PullSummary,
) -> Vec<String> {
    let mut peers = Vec::new();
    for name in children {
        if name == device_id {
            continue;
        }
        if !identity::is_valid(name) {
            summary.warnings.push(format!(
                "同步目录 {root}/ 里有一项不是设备 id（{name}）：已跳过，其它设备照常同步"
            ));
            crate::log_warn!(
                "sync stream pull: skip non-device dir {name}（全部子项 {children:?}）"
            );
            continue;
        }
        peers.push(name.clone());
    }
    peers
}

/// 拉一台对端设备：从游标的下一个 seq 起顺号探测，直到 404。
async fn pull_one_peer(
    pool: &SqlitePool,
    transport: &Transport,
    scope: &str,
    peer: &str,
    dir: &str,
    summary: &mut PullSummary,
) -> AppResult<()> {
    let cursor = repository::get(pool, scope, peer).await?;
    let last_op_id = cursor.as_ref().map(|c| c.last_op_id).unwrap_or(0);
    let last_seq = cursor.as_ref().map(|c| c.last_seq).unwrap_or(0);
    let mut seq = last_seq.saturating_add(1);

    /* GET 顺号探测：seq 稠密单调，读到 404 即追平（见模块头）。 */
    loop {
        let Ok(sequence) = u32::try_from(seq) else {
            summary.errors.push(format!("写入流 {dir} 分段序号已用尽"));
            break;
        };
        let rel = format!("{dir}/{}.jsonl", format_seq(sequence));
        match transport.get(&rel).await {
            Ok(Some(bytes)) => {
                summary.segments += 1;
                /* 解码 / 折叠失败**一律不推进游标**，直接结束这台设备的本轮。
                一旦把游标推过去，这一段里的事件就再也不会被重拉：对端会话永久缺一条
                `stop`，而本地表现只是「少了几条记录」——没有任何报错。
                设计文档 §4.4「永不自动丢弃」落到事件流这条路径，就是这一个 `break`。 */
                let ops = match decode_segment(&bytes) {
                    Ok(ops) => ops,
                    Err(err) => {
                        summary.errors.push(format!(
                            "分段 {rel} 解析失败（{err}）；游标停在 seq={}，下一轮重试，不会跳过",
                            seq - 1
                        ));
                        crate::log_warn!("sync stream pull: bad segment {rel}: {err}");
                        break;
                    }
                };
                if ops.is_empty() || ops.iter().any(|op| op.device_id != peer) {
                    summary
                        .errors
                        .push(format!("分段 {rel} 为空或包含其它设备事件，游标不推进"));
                    break;
                }
                match apply_segment(pool, scope, &rel, &ops, peer, seq, last_op_id).await {
                    Ok(applied) => {
                        summary.events += ops.len();
                        summary.applied += applied;
                    }
                    Err(err) => {
                        summary.errors.push(format!(
                            "分段 {rel} 折叠失败（{}）；游标停在 seq={}，下一轮重试",
                            err.message,
                            seq - 1
                        ));
                        crate::log_warn!("sync stream pull: fold failed on {rel}: {}", err.message);
                        break;
                    }
                }
                seq = seq.saturating_add(1);
            }
            Ok(None) => break,
            Err(err) => {
                summary.errors.push(err);
                break;
            }
        }
    }
    Ok(())
}

/// 应用一个分段，并把**游标推进放进同一个事务**（评审 P1-2）。
///
/// 为什么非得同事务：分开写时存在「事件 + 物化都已落库、游标没落库」的中间态。下一轮重拉
/// 同一段，`ON CONFLICT(uid) DO NOTHING` 让每条事件都 `rows_affected = 0`，于是没有会话被
/// 标 dirty、折叠被整段跳过，游标却顺利推进 —— 那部分 `time_records` 永远停在半截，
/// 且再没有任何一轮会去修它。同事务之后，任何一步失败都整体回滚到段前，重试必然重新折叠。
///
/// 返回这一段**新插入**的事件数。
async fn apply_segment(
    pool: &SqlitePool,
    scope: &str,
    rel: &str,
    ops: &[crate::services::timer_ops::TimerOp],
    peer: &str,
    seq: i64,
    last_op_id: i64,
) -> AppResult<usize> {
    let mut tx = pool.begin().await.map_err(AppError::db)?;
    let outcome = apply_and_fold(&mut tx, ops).await?;
    let max_op_id = ops
        .iter()
        .map(|op| op.op_id)
        .fold(last_op_id, |acc, op_id| acc.max(op_id));
    repository::upsert_in(&mut tx, scope, peer, max_op_id, seq).await?;
    tx.commit().await.map_err(AppError::db)?;
    crate::log_debug!("sync stream pull: {rel} committed with cursor seq={seq}");
    Ok(outcome.applied)
}
