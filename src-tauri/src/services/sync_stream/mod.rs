//! 同步事件流（`sync_stream`）：计时事件的跨端增量传输。
//!
//! ## 这一层在重构里的位置
//!
//! 计时从「全天 md 快照」切到「不可变分段 JSONL」的增量事件（架构设计 §1.2）：
//! - 上传（[`push_new_events`]）：把本机新增 `timer_ops` 写进 `sync/events/<device_id>/<seq>.jsonl`；
//! - 下载（[`pull_segments`]）：读「序号 > 我的游标」的分段，uid 唯一索引 upsert 去重后折叠；
//! - 折叠（[`apply_and_fold`]）：复用 `fold_session`，把事件物化回 `time_records`。
//!
//! ## 双游标共用一张 `sync_event_cursor`
//!
//! 架构 §1.2 说「两张游标」：上传游标（本机 `op_id` 已传上界）与下载游标（从对端读到哪）。
//! T01 只建了一张 `sync_event_cursor(device_id PK, last_op_id, last_seq)`。这里**复用同一张表**，
//! 用 key 区分方向：
//!
//! - key = **本机** device_id → 上传游标（`last_op_id`=本机已传最大 op_id，`last_seq`=本机最后分段号）；
//! - key = **对端** device_id → 下载游标（`last_op_id`=对端已读最大 op_id，`last_seq`=对端最后分段号）。
//!
//! `device_id` 是 12 位小写 hex、全局唯一，本机与任何对端都不会撞 key，所以一张表两用
//! 不会串。这样避免了为上传游标再开一张表（T01 已把表建好，直接可用）。
//!
//! ## 为什么下载用 GET 顺号探测而不是 LIST 分段
//!
//! 分段 seq 是**稠密单调**的（本机每轮写 `last_seq+1`），所以「读 `seq > 游标` 的分段」
//! 可以退化成「GET `<seq>.jsonl`，404 即追平」，不必对 `sync/events/<device>/` 发 PROPFIND。
//! 只有**发现对端设备**（列 `sync/events/` 的直接子目录）才发一次 depth-1 PROPFIND，
//! 而那个目录数量 = 设备数（个位数），远在坚果云 750 条上限之内。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::platform::clock::now_ms;
use crate::repositories::timer_ops as repo;
use crate::services::identity;
use crate::services::timer_ops::{fold_session, FoldedBlock, TimerOp, TimerOpKind};

pub mod repository;
pub mod segment;
pub mod transport;

use segment::{decode_segment, encode_segment, segment_path};
use transport::Transport;

/// 上传一轮的结果。
#[derive(Debug, Default)]
pub struct PushSummary {
    /// 本轮写出的分段序号（0 = 没有新事件可传）。
    pub segment_seq: u32,
    /// 本轮上传的事件数。
    pub events: usize,
    /// 本轮上传的字节数（JSONL 长度）。
    pub bytes: usize,
    /// 传输层失败（不折 `AppError`，交给 `report.errors`）。
    pub errors: Vec<String>,
}

/// 下载一轮的结果。
#[derive(Debug, Default)]
pub struct PullSummary {
    /// 发现的对端设备数。
    pub peers: usize,
    /// 读到的分段数。
    pub segments: usize,
    /// 解析出的事件数。
    pub events: usize,
    /// 新插入本地的事件数（uid 去重后）。
    pub applied: usize,
    /// 传输层失败。
    pub errors: Vec<String>,
}

/// 折叠 + 物化一轮的结果。
#[derive(Debug, Default)]
pub struct FoldOutcome {
    /// 新插入的事件数（uid 去重后）。
    pub applied: usize,
    /// 折叠过的会话数。
    pub sessions: usize,
    /// 物化（UPDATE / INSERT）的 `time_records` 行数。
    pub materialized: usize,
    /// 被 drop 掉（软删）的会话数。
    pub dropped: usize,
    /// `fold_session` 忽略的事件数。
    pub ignored: usize,
}

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

    match transport.put_if_absent(&rel, body.as_bytes()).await {
        Ok(_) => {
            /* 无论新写还是「已存在」（重启前写过分段但游标没推进）都推进游标。
               分段不可变、只写一次，uid 唯一索引在另一端兜底幂等。 */
            repository::upsert(pool, device_id, max_op_id, seq as i64).await?;
            summary.segment_seq = seq;
            summary.events = ops.len();
            summary.bytes = body.len();
        }
        Err(err) => {
            /* 传不上去只记错误、不折整轮（§7）：游标不动，下一轮重试这批事件。 */
            summary.errors.push(err);
        }
    }
    Ok(summary)
}

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

/// 折叠应用：uid upsert 去重 → 按会话折叠 → 物化回 `time_records`。
///
/// 只折叠「本轮真正插进新事件」的会话；重复拉同一分段时全部被 uid 唯一索引去重
/// （`rows_affected = 0`），于是**不产生重复 fold**（验收口径之一）。
pub async fn apply_and_fold(pool: &SqlitePool, ops: &[TimerOp]) -> AppResult<FoldOutcome> {
    let mut outcome = FoldOutcome::default();
    if ops.is_empty() {
        return Ok(outcome);
    }

    let mut dirty: Vec<String> = Vec::new();
    let mut mark = |session: &str| {
        if !dirty.iter().any(|s| s == session) {
            dirty.push(session.to_string());
        }
    };

    /* 第一遍：start 先落（它的 `day_key` = 自身语义时刻的本地日）。 */
    for op in ops.iter().filter(|op| op.kind == TimerOpKind::Start) {
        let day = identity::local_day_key(op.at_ms).map_err(AppError::db)?;
        if upsert_op(pool, op, &day).await? {
            outcome.applied += 1;
            mark(&op.session_uid);
        }
    }

    /* 第二遍：非 start（`day_key` 从库里该会话的 start 查，查不到退化成本事件本地日）。 */
    for op in ops.iter().filter(|op| op.kind != TimerOpKind::Start) {
        let day = day_key_for_non_start(pool, op).await?;
        if upsert_op(pool, op, &day).await? {
            outcome.applied += 1;
            mark(&op.session_uid);
        }
    }

    /* 先折叠、收集块，再按 `started_at_ms` 排序后物化。顺序不能省：`uq_records_open_per_device`
       是「每设备一条 active」，同一设备「先结束/丢弃旧会话、再开新会话」的两条事件若落在
       同一分段，必须先收口旧块、再插新块，否则新块的 active 会撞唯一索引。 */
    let mut blocks: Vec<FoldedBlock> = Vec::new();
    for session in &dirty {
        let all = repo::load_session(pool, session).await?;
        let folded = fold_session(&all);
        outcome.ignored += folded.ignored.len();
        if let Some(block) = folded.block {
            blocks.push(block);
        }
    }
    blocks.sort_by(|left, right| {
        left.started_at_ms
            .cmp(&right.started_at_ms)
            .then_with(|| left.session_uid.cmp(&right.session_uid))
    });

    for block in blocks {
        outcome.sessions += 1;
        if block.dropped {
            soft_delete_by_uid(pool, &block).await?;
            outcome.dropped += 1;
        } else {
            apply_block(pool, &block).await?;
            outcome.materialized += 1;
        }
    }

    Ok(outcome)
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

/// 一条远端事件入 `timer_ops`（uid 唯一索引 upsert，已存在则不动）。返回是否**新插入**。
async fn upsert_op(pool: &SqlitePool, op: &TimerOp, day_key: &str) -> AppResult<bool> {
    let affected = sqlx::query(
        "INSERT INTO timer_ops(session_uid, item_uid, kind, at_ms, day_key, payload, created_at, device_id, uid)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?7, ?8)
         ON CONFLICT(uid) WHERE uid IS NOT NULL DO NOTHING",
    )
    .bind(&op.session_uid)
    .bind(&op.item_uid)
    .bind(op.kind.as_str())
    .bind(op.at_ms)
    .bind(day_key)
    .bind(op.payload.as_deref())
    .bind(&op.device_id)
    .bind(&op.uid)
    .execute(pool)
    .await
    .map_err(AppError::db)?
    .rows_affected();
    Ok(affected > 0)
}

/// 非 start 事件的 `day_key`：从库里该会话的 start 借；借不到（start 还没拉到）退化成
/// 本事件的本地日。`day_key` 只喂 `idx_timer_ops_day` 与 T04 按天导出，不参与折叠。
async fn day_key_for_non_start(pool: &SqlitePool, op: &TimerOp) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT day_key FROM timer_ops WHERE session_uid = ?1 AND kind = 'start' ORDER BY id LIMIT 1",
    )
    .bind(&op.session_uid)
    .fetch_optional(pool)
    .await
    .map_err(AppError::db)?;
    match existing {
        Some(day) => Ok(day),
        None => identity::local_day_key(op.at_ms).map_err(AppError::db),
    }
}

/// 物化一个折叠块：已有 `time_records` 行则复用 [`repo::materialize`]（UPDATE），
/// 没有则 INSERT（对端发起的会话本机没有行）。
async fn apply_block(pool: &SqlitePool, block: &FoldedBlock) -> AppResult<()> {
    let exists: bool = sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM time_records WHERE uid = ?1)",
    )
    .bind(&block.session_uid)
    .fetch_one(pool)
    .await
    .map_err(AppError::db)?
        != 0;

    if exists {
        repo::materialize(pool, block, now_ms()).await
    } else {
        insert_record(pool, block).await
    }
}

/// 给对端发起的会话新建 `time_records` 行。`uid` **显式写**（保留对端发的 `t:<device>:<id>`，
/// 触发器见 `uid` 非空不再重发）；`item_id` 按 `item_uid` 反查，查不到退回「未归类」。
async fn insert_record(pool: &SqlitePool, block: &FoldedBlock) -> AppResult<()> {
    let item_id = resolve_item_id(pool, &block.item_uid).await?;
    let status = if block.ended_at_ms.is_some() {
        "saved"
    } else {
        "active"
    };
    sqlx::query(
        "INSERT INTO time_records(uid, device_id, item_id, status, started_at, ended_at,
                                  accumulated_sec, running_since, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?5, ?9)
         ON CONFLICT(uid) WHERE uid IS NOT NULL DO NOTHING",
    )
    .bind(&block.session_uid)
    .bind(&block.device_id)
    .bind(item_id)
    .bind(status)
    .bind(block.started_at_ms)
    .bind(block.ended_at_ms)
    .bind(block.accumulated_sec())
    .bind(block.running_since_ms)
    .bind(now_ms())
    .execute(pool)
    .await
    .map_err(AppError::db)?;
    Ok(())
}

/// `item_uid` → 本地 `item_id`；事项还没同步过来时退回系统事项「未归类」（id=1）。
async fn resolve_item_id(pool: &SqlitePool, item_uid: &str) -> AppResult<i64> {
    let id: Option<i64> = sqlx::query_scalar("SELECT id FROM items WHERE uid = ?1")
        .bind(item_uid)
        .fetch_optional(pool)
        .await
        .map_err(AppError::db)?;
    Ok(id.unwrap_or(crate::models::constants::SYSTEM_ITEM_ID))
}

/// drop 掉的会话：软删本机那一行（与本地 `timer::discard` 的「drop 是事件」同语义）。
async fn soft_delete_by_uid(pool: &SqlitePool, block: &FoldedBlock) -> AppResult<()> {
    let now = now_ms();
    let ended_at = block.ended_at_ms.unwrap_or(now);
    sqlx::query(
        "UPDATE time_records
            SET status = 'saved', accumulated_sec = ?2, ended_at = ?3,
                running_since = NULL, deleted_at = ?4, updated_at = ?4
          WHERE uid = ?1",
    )
    .bind(&block.session_uid)
    .bind(block.accumulated_sec())
    .bind(ended_at)
    .bind(now)
    .execute(pool)
    .await
    .map_err(AppError::db)?;
    Ok(())
}

#[cfg(test)]
mod tests;
