//! 计时会话生命周期 SQL（time_records 表）：开始 / 暂停 / 结束 / 撤销 / 恢复 / 分段。

use sqlx::SqlitePool;

use crate::error::AppResult;
use crate::models::record::TimeRecord;

use super::record::COLS;

/// 查询全局唯一 active 会话（排除已软删除）。
pub async fn find_active(pool: &SqlitePool) -> AppResult<Option<TimeRecord>> {
    let sql = format!(
        "SELECT {COLS} FROM time_records \
         WHERE status = 'active' AND deleted_at IS NULL LIMIT 1"
    );
    Ok(sqlx::query_as::<_, TimeRecord>(&sql)
        .fetch_optional(pool)
        .await?)
}

/// 新建 active 会话并返回新 id。
pub async fn insert_active(pool: &SqlitePool, item_id: i64, now: i64) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at) \
         VALUES (?, 'active', ?, NULL, 0, ?, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// [V0.2.0] 新建 active **倒计时**会话并返回新 id（`mode='countdown'`，`target_sec` 非空）。
pub async fn insert_active_countdown(
    pool: &SqlitePool,
    item_id: i64,
    target_sec: i64,
    now: i64,
) -> AppResult<i64> {
    let id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, mode, target_sec, created_at, updated_at) \
         VALUES (?, 'active', ?, NULL, 0, ?, 'countdown', ?, ?, ?) RETURNING id",
    )
    .bind(item_id)
    .bind(now)
    .bind(now)
    .bind(target_sec)
    .bind(now)
    .bind(now)
    .fetch_one(pool)
    .await?;
    Ok(id)
}

/// 更新累计秒数与当前段起点（running_since=None 表示暂停）。
pub async fn set_accum_and_running(
    pool: &SqlitePool,
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
    .execute(pool)
    .await?;
    Ok(())
}

/// 结束会话：置 saved、冻结累计、ended_at 落盘。
pub async fn finalize(
    pool: &SqlitePool,
    id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active'",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 撤销结束：saved 回滚为 active（ended_at=NULL，running_since=now）。
pub async fn reactivate(pool: &SqlitePool, id: i64, running_since: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records \
         SET status = 'active', ended_at = NULL, running_since = ?, updated_at = ? \
         WHERE id = ? AND status = 'saved' AND deleted_at IS NULL",
    )
    .bind(running_since)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 仅更改 active 会话归属事项（时长连续）。
pub async fn set_item_id(pool: &SqlitePool, id: i64, item_id: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records SET item_id = ?, updated_at = ? WHERE id = ? AND status = 'active'",
    )
    .bind(item_id)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 丢弃 active 会话：置 saved + ended_at + 软删除（释放单 active 唯一槽，R-5）。
pub async fn discard(pool: &SqlitePool, id: i64, ended_at: i64, now: i64) -> AppResult<()> {
    sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, running_since = NULL, deleted_at = ?, updated_at = ? \
         WHERE id = ? AND status = 'active'",
    )
    .bind(ended_at)
    .bind(now)
    .bind(now)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(())
}

/// 分段换事项：事务内结束旧会话并新开一条 active，返回新 id。
pub async fn end_and_start(
    pool: &SqlitePool,
    old_id: i64,
    new_item_id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
) -> AppResult<i64> {
    let mut tx = pool.begin().await?;
    sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active'",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(old_id)
    .execute(&mut *tx)
    .await?;
    let new_id: i64 = sqlx::query_scalar(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at) \
         VALUES (?, 'active', ?, NULL, 0, ?, ?, ?) RETURNING id",
    )
    .bind(new_item_id)
    .bind(now)
    .bind(now)
    .bind(now)
    .bind(now)
    .fetch_one(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(new_id)
}
