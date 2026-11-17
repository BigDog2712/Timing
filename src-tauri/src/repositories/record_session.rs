//! 计时会话生命周期 SQL（time_records 表）：开始 / 暂停 / 结束 / 撤销 / 恢复 / 分段。

use sqlx::{SqliteConnection, SqlitePool};

use crate::error::{AppError, AppResult};
use crate::models::record::TimeRecord;

use super::record::COLS;

/// 把 `uq_records_open` 的唯一索引冲突翻成业务错误码。
///
/// `start` 是「先查 active、再 insert」两步，两个并发调用可能都查到空，
/// 第二条 insert 撞唯一索引。若原样冒泡就是 `DB_ERROR`，前端只能提示「数据库操作失败」；
/// 这里识别唯一冲突并返回 `TIMER_ALREADY_RUNNING`，与串行路径同一语义。
fn active_conflict(err: sqlx::Error) -> AppError {
    if let sqlx::Error::Database(db) = &err {
        if db.is_unique_violation() {
            return AppError::timer_already_running();
        }
    }
    err.into()
}

/// 查询全局唯一 active 会话（排除已软删除）；脏数据多条时取最早一条（边界②）。
pub async fn find_active(pool: &SqlitePool) -> AppResult<Option<TimeRecord>> {
    Ok(find_all_active(pool).await?.into_iter().next())
}

/// 全部 active 会话，`started_at` 升序；崩溃恢复（边界②）与退出收尾共用。
pub async fn find_all_active(pool: &SqlitePool) -> AppResult<Vec<TimeRecord>> {
    let sql = format!(
        "SELECT {COLS} FROM time_records \
         WHERE status = 'active' AND deleted_at IS NULL ORDER BY started_at ASC, id ASC"
    );
    Ok(sqlx::query_as::<_, TimeRecord>(&sql).fetch_all(pool).await?)
}

/// 新建 active 会话并返回新 id。
///
/// ⚠️ `device_id` 必须显式写：`uid` 由 AFTER INSERT 触发器按它拼（`t:<device>:<id>`）。
/// 漏了 → uid 恒 NULL → 这行永不被同步导出，且零报错（早前这个 INSERT 就没写）。
/// 取不到身份时退化成哨兵 `''` 而不是报错：按下开始必须能开始，交给下次启动认领。
/* 生产路径全走 `insert_active_in`（`timer::start` 要同事务写 start 事件）；这个薄封装
   只剩测试在用（`tests/daily_status.rs` 建一条 active 行），所以只对 lib 豁免死码。 */
#[cfg_attr(not(test), allow(dead_code))]
pub async fn insert_active(pool: &SqlitePool, item_id: i64, now: i64) -> AppResult<i64> {
    let mut conn = pool.acquire().await.map_err(AppError::db)?;
    insert_active_in(&mut conn, item_id, now).await
}

/// [`insert_active`] 的事务内版本（S3：状态行与 start 事件必须一起落）。
pub(crate) async fn insert_active_in(
    conn: &mut SqliteConnection,
    item_id: i64,
    now: i64,
) -> AppResult<i64> {
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at, device_id) \
         VALUES (?, 'active', ?, NULL, 0, ?, ?, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(device_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(active_conflict)?;
    Ok(id)
}

/// [V0.2.0] 新建 active **倒计时**会话并返回新 id（`mode='countdown'`，`target_sec` 非空）。
///
/// `device_id` 的理由同 [`insert_active`]：uid 靠触发器按它发，漏写就永不同步。
/// 参数是**调用方的事务**（S3）：倒计时的 start 事件必须与这一行同事务落，
/// 否则事件流里没有起点、对端 fold 会把后面的 stop 当孤儿丢掉。
pub(crate) async fn insert_active_countdown(
    conn: &mut SqliteConnection,
    item_id: i64,
    target_sec: i64,
    now: i64,
) -> AppResult<i64> {
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, mode, target_sec, created_at, updated_at, device_id) \
         VALUES (?, 'active', ?, NULL, 0, ?, 'countdown', ?, ?, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(now)
    .bind(now)
    .bind(target_sec)
    .bind(now)
    .bind(now)
    .bind(device_id)
    .fetch_one(&mut *conn)
    .await
    .map_err(active_conflict)?;
    Ok(id)
}

/// [`set_accum_and_running`] 的事务内版本（S3：暂停/继续必须与事件一起落）。
pub(crate) async fn set_accum_and_running_in(
    conn: &mut SqliteConnection,
    id: i64,
    accumulated_sec: i64,
    running_since: Option<i64>,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records SET accumulated_sec = ?, running_since = ?, updated_at = ? \
         WHERE id = ? AND status = 'active'",
    )
    .bind(accumulated_sec)
    .bind(running_since)
    .bind(now)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/// Flush only if the active snapshot has not been changed by pause/resume or another flush.
pub async fn flush_snapshot(
    pool: &SqlitePool,
    id: i64,
    expected_accumulated_sec: i64,
    expected_running_since: i64,
    accumulated_sec: i64,
    running_since: i64,
    now: i64,
) -> AppResult<bool> {
    let affected = sqlx::query(
        "UPDATE time_records SET accumulated_sec = ?, running_since = ?, updated_at = ? WHERE id = ? AND status = 'active' AND accumulated_sec = ? AND running_since = ?",
    )
    .bind(accumulated_sec)
    .bind(running_since)
    .bind(now)
    .bind(id)
    .bind(expected_accumulated_sec)
    .bind(expected_running_since)
    .execute(pool)
    .await?
    .rows_affected();
    Ok(affected == 1)
}

/* 结束 / 跨天拆分段落库移到 `record_session_split.rs`（本文件压在 300 行硬限上，
   而那一对函数自带 20 行口径说明）。在此 re-export：`record_session::finalize*`
   的调用点写法不变。 */
/* [S3] 这一对改成收**调用方的事务**（原来是 `pool`）：结束会话与 `stop` 事件必须一起落。
   `pub(crate)` 而不是 `pub`：只在「我已经有事务」时才有意义，对外暴露会诱使调用方
   先 begin 再忘 commit。 */
pub(crate) use crate::repositories::record_session_split::{finalize, finalize_split};

/// 撤销结束：saved 回滚为 active，并让调用方在同一事务里补记 `resume`。
pub(crate) async fn reactivate_in(conn: &mut SqliteConnection, id: i64, running_since: i64, now: i64) -> AppResult<bool> {
    let changed = sqlx::query(
        "UPDATE time_records \
         SET status = 'active', ended_at = NULL, running_since = ?, updated_at = ? \
         WHERE id = ? AND status = 'saved' AND deleted_at IS NULL",
    )
    .bind(running_since)
    .bind(now)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(changed.rows_affected() == 1)
}

/// 仅更改 active 会话归属事项（时长连续）。返回新事项的 `uid`（没认领身份时为 `None`）。
pub(crate) async fn set_item_id_in(
    conn: &mut SqliteConnection,
    id: i64,
    item_id: i64,
    now: i64,
) -> AppResult<Option<String>> {
    sqlx::query(
        "UPDATE time_records SET item_id = ?, updated_at = ? WHERE id = ? AND status = 'active'",
    )
    .bind(item_id)
    .bind(now)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    let uid: Option<Option<String>> = sqlx::query_scalar("SELECT uid FROM items WHERE id = ?")
        .bind(item_id)
        .fetch_optional(&mut *conn)
        .await?;
    Ok(uid.flatten())
}

/// [`discard`] 的事务内版本（S3：丢弃也要和 `drop` 事件一起落）。
pub(crate) async fn discard_in(
    conn: &mut SqliteConnection,
    id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', accumulated_sec = ?, ended_at = ?, running_since = NULL, \
             deleted_at = ?, updated_at = ? \
         WHERE id = ? AND status = 'active'",
    )
    .bind(accumulated_sec)
    .bind(ended_at)
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(&mut *conn)
    .await?;
    Ok(())
}

/* 分段换事项移到 `record_session_switch.rs`（本文件贴着 300 行硬限）。
   池版本与事务内版本都在那边，这里 re-export 让既有调用点写法不变。 */
#[cfg(test)]
pub use crate::repositories::record_session_switch::end_and_start;
pub(crate) use crate::repositories::record_session_switch::end_and_start_in;

