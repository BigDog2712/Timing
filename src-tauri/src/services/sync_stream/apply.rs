//! 折叠应用：uid upsert 去重 → 按会话折叠 → 物化回 `time_records`。
//!
//! ## 为什么全链路只收 `&mut SqliteConnection`（2026-11-16，评审 P1-2）
//!
//! 这个模块由 `sync_stream::pull` 在**一段一个事务**里调用，事务里还包括游标推进。
//! 原来每一步各自拿 `&SqlitePool`（= 各自的自动提交事务），于是存在一个致命的中间态：
//!
//! 1. 事件 upsert 进去了、物化写了、进程/数据库在中途失败 → 游标没推进，下一轮会重来；
//! 2. 重来时 `ON CONFLICT(uid) DO NOTHING` 对每条已存在的事件都返回 `rows_affected = 0`，
//!    于是**没有任何会话被标 dirty**，折叠整段被跳过；
//! 3. 游标顺利推进 —— 那些会话的 `time_records` 永远停在半截，且再没有任何一轮修它。
//!
//! 全部收进调用方的事务之后，1 处失败就整体回滚，`timer_ops` 与 `time_records` 一起回到
//! 段前状态，重试必然重新折叠。判据见 `tests_integrity.rs`
//! 的 `failed_apply_leaves_no_half_state_and_retry_converges`。

use sqlx::SqliteConnection;

use crate::error::{AppError, AppResult};
use crate::platform::clock::now_ms;
use crate::repositories::timer_ops as repo;
use crate::services::identity;
use crate::services::timer_ops::{fold_session, FoldedBlock, TimerOp, TimerOpKind};

use super::FoldOutcome;

/// 折叠应用：uid upsert 去重 → 按会话折叠 → 物化回 `time_records`。
///
/// 只折叠「本轮真正插进新事件」的会话；重复拉同一分段时全部被 uid 唯一索引去重
/// （`rows_affected = 0`），于是**不产生重复 fold**（验收口径之一）。
pub async fn apply_and_fold(conn: &mut SqliteConnection, ops: &[TimerOp]) -> AppResult<FoldOutcome> {
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
        if upsert_op(&mut *conn, op, &day).await? {
            outcome.applied += 1;
            mark(&op.session_uid);
        }
    }

    /* 第二遍：非 start（`day_key` 从库里该会话的 start 查，查不到退化成本事件本地日）。 */
    for op in ops.iter().filter(|op| op.kind != TimerOpKind::Start) {
        let day = day_key_for_non_start(&mut *conn, op).await?;
        if upsert_op(&mut *conn, op, &day).await? {
            outcome.applied += 1;
            mark(&op.session_uid);
        }
    }

    /* 先折叠、收集块，再按 `started_at_ms` 排序后物化。顺序不能省：`uq_records_open_per_device`
       是「每设备一条 active」，同一设备「先结束/丢弃旧会话、再开新会话」的两条事件若落在
       同一分段，必须先收口旧块、再插新块，否则新块的 active 会撞唯一索引。 */
    let mut blocks: Vec<FoldedBlock> = Vec::new();
    for session in &dirty {
        let all = repo::load_session(&mut *conn, session).await?;
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
            soft_delete_by_uid(&mut *conn, &block).await?;
            outcome.dropped += 1;
        } else {
            apply_block(&mut *conn, &block).await?;
            outcome.materialized += 1;
        }
    }

    Ok(outcome)
}

/// 一条远端事件入 `timer_ops`（uid 唯一索引 upsert，已存在则不动）。返回是否**新插入**。
async fn upsert_op(conn: &mut SqliteConnection, op: &TimerOp, day_key: &str) -> AppResult<bool> {
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
    .execute(&mut *conn)
    .await
    .map_err(AppError::db)?
    .rows_affected();
    Ok(affected > 0)
}

/// 非 start 事件的 `day_key`：从库里该会话的 start 借；借不到（start 还没拉到）退化成
/// 本事件的本地日。`day_key` 只喂 `idx_timer_ops_day` 与 T04 按天导出，不参与折叠。
async fn day_key_for_non_start(conn: &mut SqliteConnection, op: &TimerOp) -> AppResult<String> {
    let existing: Option<String> = sqlx::query_scalar(
        "SELECT day_key FROM timer_ops WHERE session_uid = ?1 AND kind = 'start' ORDER BY id LIMIT 1",
    )
    .bind(&op.session_uid)
    .fetch_optional(&mut *conn)
    .await
    .map_err(AppError::db)?;
    match existing {
        Some(day) => Ok(day),
        None => identity::local_day_key(op.at_ms).map_err(AppError::db),
    }
}

/// 物化一个折叠块：已有 `time_records` 行则复用 [`repo::materialize_in`]（UPDATE），
/// 没有则 INSERT（对端发起的会话本机没有行）。
async fn apply_block(conn: &mut SqliteConnection, block: &FoldedBlock) -> AppResult<()> {
    let exists: bool = sqlx::query_scalar::<_, i64>(
        "SELECT EXISTS(SELECT 1 FROM time_records WHERE uid = ?1)",
    )
    .bind(&block.session_uid)
    .fetch_one(&mut *conn)
    .await
    .map_err(AppError::db)?
        != 0;

    if exists {
        repo::materialize_in(&mut *conn, block, now_ms()).await
    } else {
        insert_record(&mut *conn, block).await
    }
}

/// 给对端发起的会话新建 `time_records` 行。`uid` **显式写**（保留对端发的 `t:<device>:<id>`，
/// 触发器见 `uid` 非空不再重发）；`item_id` 按 `item_uid` 反查，查不到退回「未归类」。
async fn insert_record(conn: &mut SqliteConnection, block: &FoldedBlock) -> AppResult<()> {
    let item_id = resolve_item_id(&mut *conn, &block.item_uid).await?;
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
    .execute(&mut *conn)
    .await
    .map_err(AppError::db)?;
    Ok(())
}

/// `item_uid` → 本地 `item_id`；事项还没同步过来时退回系统事项「未归类」（id=1）。
async fn resolve_item_id(conn: &mut SqliteConnection, item_uid: &str) -> AppResult<i64> {
    let id: Option<i64> = sqlx::query_scalar("SELECT id FROM items WHERE uid = ?1")
        .bind(item_uid)
        .fetch_optional(&mut *conn)
        .await
        .map_err(AppError::db)?;
    Ok(id.unwrap_or(crate::models::constants::SYSTEM_ITEM_ID))
}

/// drop 掉的会话：软删本机那一行（与本地 `timer::discard` 的「drop 是事件」同语义）。
async fn soft_delete_by_uid(conn: &mut SqliteConnection, block: &FoldedBlock) -> AppResult<()> {
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
    .execute(&mut *conn)
    .await
    .map_err(AppError::db)?;
    Ok(())
}
