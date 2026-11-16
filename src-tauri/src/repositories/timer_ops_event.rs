//! 计时事件的**事务内**写入（S3）。
//!
//! ## 为什么单独一个文件
//!
//! 「状态行与事件流必须一起落」这个约束原来不存在：`services::timer_events::record`
//! 自己开事务追加事件，状态写走另一条 UPDATE。于是「暂停成功、事件没写进去」时，
//! 本机看到的是暂停了，对端 fold 出来的是「还在跑」——**两端从此各走各的，本地零感知**。
//!
//! 修法是把两者塞进同一个事务，而这要求写入函数能接受调用方的事务句柄
//! （`&mut SqliteConnection`）。本文件只做这一件事：把 `timer_ops` 的写入函数从
//! 「自己 `pool.begin()`」改成「用你给我的连接」。`timer_ops.rs` 的公开函数原样保留
//! （各自开一个事务再委托过来），所以既有调用点零改动。
//!
//! 拆文件而不是就地改：`timer_ops.rs` 已经 292 行，塞不下这些实现。

use sqlx::SqliteConnection;

use crate::error::AppResult;
use crate::services::timer_ops::{TimerOp, TimerOpKind};

use super::timer_ops::{to_op, OP_COLS};

/// 一条待写入的事件。收成结构体而不是继续加参数：位置参数里 `at_ms` 与 `day_key`
/// 相邻、`payload` 与 `device_id` 都是 `&str`，调用点写反了照样能编译。
pub(crate) struct NewOp<'a> {
    pub session_uid: &'a str,
    pub item_uid: &'a str,
    pub kind: TimerOpKind,
    pub at_ms: i64,
    pub day_key: &'a str,
    pub payload: Option<&'a str>,
    pub device_id: &'a str,
}

/// 插一行事件，返回自增 id。
///
/// `device_id` 必须显式写：`uid` 由 AFTER INSERT 触发器按它拼出来（`p:<device>:<id>`），
/// 漏了它 → uid 恒为 NULL → 这条事件永远不会被导出，而且不报错。
pub(crate) async fn insert_op(conn: &mut SqliteConnection, op: &NewOp<'_>) -> AppResult<i64> {
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
    .execute(&mut *conn)
    .await?;
    Ok(
        sqlx::query_scalar("SELECT last_insert_rowid()")
            .fetch_one(&mut *conn)
            .await?,
    )
}

/// 读回刚写的那一行（同事务内可见）。
pub(crate) async fn load_op(conn: &mut SqliteConnection, op_id: i64) -> AppResult<TimerOp> {
    let sql = format!("SELECT {OP_COLS} FROM timer_ops WHERE id = ?1");
    let row = sqlx::query(&sql).bind(op_id).fetch_one(&mut *conn).await?;
    to_op(&row).ok_or_else(|| {
        crate::error::AppError::db(format!("timer_ops row {op_id} could not be decoded"))
    })
}

/// 追加一条事件（用调用方的连接）。会话必须已存在（`start` 先落）。
pub(crate) async fn append(
    conn: &mut SqliteConnection,
    session_uid: &str,
    kind: TimerOpKind,
    at_ms: i64,
    day_key: &str,
    payload: Option<&str>,
    device_id: &str,
) -> AppResult<TimerOp> {
    /* `item_uid` 从**会话当前的**事项取，不从「第一条事件」复制：第一条事件（`start`）
       没有前驱可抄（按前驱取会让起点永远写不进去，实测报错 `... has no start event`），
       而事项还可以被 `switch` 改判。冗余存一份是为了按事项查事件时不必回连会话表。 */
    let item_uid: Option<String> = sqlx::query_scalar(
        "SELECT i.uid FROM time_records r JOIN items i ON i.id = r.item_id WHERE r.uid = ?1",
    )
    .bind(session_uid)
    .fetch_optional(&mut *conn)
    .await?;
    let item_uid = item_uid.ok_or_else(|| {
        crate::error::AppError::db(format!(
            "timer session `{session_uid}` has no item uid; device identity was not adopted"
        ))
    })?;

    let op_id = insert_op(
        conn,
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
    load_op(conn, op_id).await
}

/// 按 `record_id` 追加一条事件（先查会话 uid 与日键）。
///
/// 返回 `Ok(None)` 的两种情况**不是失败**，是「这条事件没有同步语义」：
/// 没有 install id（设备身份还没认领）、会话没有 uid。它们沿用原口径跳过；
/// 真正的写入错误一律 `Err`，由调用方的事务回滚 —— 这是 S3 的核心：
/// **允许「不适用」，不允许「静默丢」**。
pub(crate) async fn append_for_record(
    conn: &mut SqliteConnection,
    record_id: i64,
    kind: TimerOpKind,
    at_ms: i64,
    payload: Option<&str>,
) -> AppResult<Option<TimerOp>> {
    let Some(device_id) = crate::services::identity::install_id() else {
        crate::log_warn!("timer event `{}` skipped: no install id", kind.as_str());
        return Ok(None);
    };
    let row: Option<(Option<String>, i64)> =
        sqlx::query_as("SELECT uid, started_at FROM time_records WHERE id = ?1")
            .bind(record_id)
            .fetch_optional(&mut *conn)
            .await?;
    let Some((Some(session_uid), started_at)) = row else {
        crate::log_warn!(
            "timer event `{}` skipped: record {record_id} has no uid",
            kind.as_str()
        );
        return Ok(None);
    };
    let day_key = crate::services::identity::local_day_key(started_at)
        .map_err(crate::error::AppError::db)?;
    Ok(Some(
        append(conn, &session_uid, kind, at_ms, &day_key, payload, device_id).await?,
    ))
}
