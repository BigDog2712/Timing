//! 计时事件仓库（`timer_ops`）：追加、按会话读、折叠后物化回 `time_records`。
//!
//! ## 这一层的职责边界
//!
//! - **只碰 SQL**：本地日键（`day_key`）由调用方算好传进来。本层不引 `chrono`、
//!   不判时区 —— 日界口径一旦有两处实现，跨天会话就会在两端落进不同的分片。
//! - **不做决策**：折叠语义全在 `services::timer_ops::fold_session`（纯函数、可单测）。
//!   这里只负责把事件读出来、把结果写回去。
//!
//! ## 为什么 `session_uid` 必须由库分配
//!
//! `start` 事件要指向一个 `time_records.uid`，而那个 uid 由库的触发器按自增 id 生成
//! （`t:<device>:<id>`）。所以顺序只能是「先 INSERT 会话 → 读到 uid → 再写 start 事件」，
//! 反过来（先编一个 uid 再插会话）会让触发器与预编值打架，或者绕过触发器手拼 uid ——
//! 后者在设备 id 认领失败时会写出 `t::12` 这种半截身份。

use sqlx::{Row, SqlitePool};

use crate::error::AppResult;
use crate::services::timer_ops::{fold_session, FoldResult, FoldedBlock, TimerOp, TimerOpKind};

const OP_COLS: &str = "id, uid, session_uid, item_uid, kind, at_ms, payload, device_id";

fn to_op(row: &sqlx::sqlite::SqliteRow) -> Option<TimerOp> {
    Some(TimerOp {
        uid: row.try_get::<Option<String>, _>("uid").ok()??,
        op_id: row.try_get("id").ok()?,
        device_id: row.try_get("device_id").ok()?,
        session_uid: row.try_get("session_uid").ok()?,
        item_uid: row.try_get("item_uid").ok()?,
        kind: TimerOpKind::parse(&row.try_get::<String, _>("kind").ok()?)?,
        at_ms: row.try_get("at_ms").ok()?,
        payload: row.try_get("payload").ok()?,
    })
}

/// 开一个新会话：建 `time_records` 行（由触发器发 `t:` uid）并写下 `start` 事件。
///
/// 返回刚写入的 `start` 事件；`session_uid` 就是调用方后续要用的那个。
pub async fn start_session(
    pool: &SqlitePool,
    item_id: i64,
    at_ms: i64,
    day_key: &str,
    mode: &str,
    target_sec: Option<i64>,
    device_id: &str,
) -> AppResult<TimerOp> {
    let mut tx = pool.begin().await?;

    /* `device_id` 必须显式写：`session_uid` 由触发器按它拼出来，而认领逻辑只在启动跑一次。
       漏了它就等于「这个会话永远没有 uid 也永远不被导出」，而且不报错。 */
    sqlx::query(
        "INSERT INTO time_records(item_id, status, started_at, accumulated_sec, running_since,
                                  note, mode, target_sec, created_at, updated_at, device_id)
         VALUES (?1, 'active', ?2, 0, ?2, NULL, ?3, ?4, ?2, ?2, ?5)",
    )
    .bind(item_id)
    .bind(at_ms)
    .bind(mode)
    .bind(target_sec)
    .bind(device_id)
    .execute(&mut *tx)
    .await?;

    let id: i64 = sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(&mut *tx)
        .await?;
    let session_uid: Option<String> =
        sqlx::query_scalar("SELECT uid FROM time_records WHERE id = ?1")
            .bind(id)
            .fetch_one(&mut *tx)
            .await?;
    let item_uid: Option<Option<String>> =
        sqlx::query_scalar("SELECT uid FROM items WHERE id = ?1")
            .bind(item_id)
            .fetch_optional(&mut *tx)
            .await?;
    let item_uid = item_uid.flatten();

    /* 两个 uid 都必须已经存在：items 的由启动认领补，会话的由触发器发。
       缺失时宁可失败，也不要拼一个 `t::12` 出来 —— 那种行一旦落库就不再重算。 */
    let session_uid = session_uid.ok_or_else(|| {
        crate::error::AppError::db(format!(
            "time_records id {id} has no uid; device identity was not adopted"
        ))
    })?;
    let item_uid = item_uid.ok_or_else(|| {
        crate::error::AppError::db(format!(
            "items id {item_id} has no uid; device identity was not adopted"
        ))
    })?;

    let op_id = insert_op(
        &mut tx,
        &NewOp {
            session_uid: &session_uid,
            item_uid: &item_uid,
            kind: TimerOpKind::Start,
            at_ms,
            day_key,
            payload: Some(&payload_for_start(mode, target_sec)),
            device_id,
        },
    )
    .await?;
    tx.commit().await?;

    load_op(pool, op_id).await
}

/// 追加一条操作事件。会话必须已存在（`start` 先落）。
pub async fn append(
    pool: &SqlitePool,
    session_uid: &str,
    kind: TimerOpKind,
    at_ms: i64,
    day_key: &str,
    payload: Option<&str>,
    device_id: &str,
) -> AppResult<TimerOp> {
    let mut tx = pool.begin().await?;
    let item_uid: Option<String> =
        sqlx::query_scalar("SELECT item_uid FROM timer_ops WHERE session_uid = ?1 LIMIT 1")
            .bind(session_uid)
            .fetch_optional(&mut *tx)
            .await?;
    let item_uid = item_uid.ok_or_else(|| {
        crate::error::AppError::db(format!(
            "timer session `{session_uid}` has no start event"
        ))
    })?;

    let op_id = insert_op(
        &mut tx,
        &NewOp {
            session_uid,
            item_uid: &item_uid,
            kind,
            at_ms,
            day_key,
            payload,
            device_id,
        },
    )
    .await?;
    tx.commit().await?;
    load_op(pool, op_id).await
}

/// 一条待写入的事件。收成结构体而不是继续加参数：八个位置参数里 `at_ms` 与 `day_key`
/// 相邻、`payload` 与 `device_id` 都是 `&str`，调用点写反了照样能编译。
struct NewOp<'a> {
    session_uid: &'a str,
    item_uid: &'a str,
    kind: TimerOpKind,
    at_ms: i64,
    day_key: &'a str,
    payload: Option<&'a str>,
    device_id: &'a str,
}

async fn insert_op(
    tx: &mut sqlx::Transaction<'_, sqlx::Sqlite>,
    op: &NewOp<'_>,
) -> AppResult<i64> {
    /* `device_id` 必须显式写：`uid` 由 AFTER INSERT 触发器按它拼出来（`p:<device>:<id>`），
       漏了它 → uid 恒为 NULL → 这条事件永远不会被导出，而且不报错。 */
    sqlx::query(
        "INSERT INTO timer_ops(session_uid, item_uid, kind, at_ms, day_key, payload, created_at, device_id)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?4, ?7)",
    )
    .bind(op.session_uid)
    .bind(op.item_uid)
    .bind(op.kind.as_str())
    .bind(op.at_ms)
    .bind(op.day_key)
    .bind(op.payload)
    .bind(op.device_id)
    .execute(&mut **tx)
    .await?;
    Ok(sqlx::query_scalar("SELECT last_insert_rowid()")
        .fetch_one(&mut **tx)
        .await?)
}

async fn load_op(pool: &SqlitePool, op_id: i64) -> AppResult<TimerOp> {
    let sql = format!("SELECT {OP_COLS} FROM timer_ops WHERE id = ?1");
    let row = sqlx::query(&sql).bind(op_id).fetch_one(pool).await?;
    to_op(&row).ok_or_else(|| {
        crate::error::AppError::db(format!("timer_ops row {op_id} could not be decoded"))
    })
}

/// 读一个会话的全部事件（顺序无关：折叠自己排序）。
pub async fn load_session(pool: &SqlitePool, session_uid: &str) -> AppResult<Vec<TimerOp>> {
    let sql = format!(
        "SELECT {OP_COLS} FROM timer_ops WHERE session_uid = ?1 ORDER BY at_ms, device_id, id"
    );
    let rows = sqlx::query(&sql).bind(session_uid).fetch_all(pool).await?;
    Ok(rows.iter().filter_map(to_op).collect())
}

/// 读事件并折叠。
pub async fn fold(pool: &SqlitePool, session_uid: &str) -> AppResult<FoldResult> {
    Ok(fold_session(&load_session(pool, session_uid).await?))
}

/// 把折叠结果写回 `time_records`（物化）。
///
/// 判据：**先清空 `time_records` 里这一行再从事件重算，结果必须相同**。做不到就说明
/// 折叠漏了某个字段，那时 `time_records` 与事件流会各说各话（且没有任何报错）。
pub async fn materialize(pool: &SqlitePool, block: &FoldedBlock, now: i64) -> AppResult<()> {
    let status = if block.ended_at_ms.is_some() {
        "saved"
    } else {
        "active"
    };
    sqlx::query(
        "UPDATE time_records
            SET status = ?2, started_at = ?3, ended_at = ?4, accumulated_sec = ?5,
                running_since = ?6, updated_at = ?7
          WHERE uid = ?1",
    )
    .bind(&block.session_uid)
    .bind(status)
    .bind(block.started_at_ms)
    .bind(block.ended_at_ms)
    .bind(block.accumulated_sec())
    .bind(block.running_since_ms)
    .bind(now)
    .execute(pool)
    .await?;
    Ok(())
}

fn payload_for_start(mode: &str, target_sec: Option<i64>) -> String {
    let mut payload = format!("{{\"mode\":\"{mode}\"");
    if let Some(target) = target_sec {
        payload.push_str(&format!(",\"target_sec\":{target}"));
    }
    payload.push('}');
    payload
}
