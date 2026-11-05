//! 计时会话生命周期 SQL（time_records 表）：开始 / 暂停 / 结束 / 撤销 / 恢复 / 分段。

use sqlx::SqlitePool;

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
    .await
    .map_err(active_conflict)?;
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
    .await
    .map_err(active_conflict)?;
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
    let mut tx = pool.begin().await?;
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(now)
    .bind(id)
    .execute(&mut *tx)
    .await?;
    if saved.rows_affected() != 1 {
        // 事务未 commit 即返回：tx 被 drop 时自动回滚。
        // 0 行说明会话已被别处结束（双击结束、并发 stop），不能让调用方以为保存成功。
        return Err(AppError::timer_not_running());
    }
    super::todo::soft_delete_for_saved_record(&mut tx, id, now).await?;
    tx.commit().await?;
    Ok(())
}

/// 跨零点分段落库（V0.11.3）：把一条 active 会话按给定分段切成多条 saved。
///
/// `segments` 是升序的 `(started_at, ended_at, accumulated_sec)`，由
/// `services::timer_split::split_by_day` 算好——这里不再判断日界，只负责原子落库。
///
/// **原记录 id 保留给最后一段**：撤销条、「刚结束的那条」、md 导入的对位都还指着它。
/// 前面各段作为新行插入，`target_sec` 置 NULL——倒计时的目标只属于真正结束的那一段，
/// 否则两段各自显示一个完整目标，统计看着像跑了两次。`mode` 则整段复制：
/// 它描述的是「这次会话的性质」，拆开也还是同一种。
pub async fn finalize_split(
    pool: &SqlitePool,
    active: &TimeRecord,
    segments: &[(i64, i64, i64)],
    now: i64,
) -> AppResult<()> {
    let Some(&(last_start, last_end, last_accum)) = segments.last() else {
        return Err(AppError::invalid_duration());
    };

    let mut tx = pool.begin().await?;
    for (start, end, accum) in &segments[..segments.len() - 1] {
        sqlx::query(
            "INSERT INTO time_records \
             (item_id, status, started_at, ended_at, accumulated_sec, running_since, \
              mode, target_sec, created_at, updated_at) \
             VALUES (?, 'saved', ?, ?, ?, NULL, ?, NULL, ?, ?)",
        )
        .bind(active.item_id)
        .bind(start)
        .bind(end)
        .bind(accum)
        .bind(&active.mode)
        .bind(now)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    }
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', started_at = ?, ended_at = ?, accumulated_sec = ?, \
             running_since = NULL, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(last_start)
    .bind(last_end)
    .bind(last_accum)
    .bind(now)
    .bind(active.id)
    .execute(&mut *tx)
    .await?;
    if saved.rows_affected() != 1 {
        /* 与 `finalize` 同一口径：会话已被别处结束时不假装成功（tx 丢弃即回滚）。 */
        return Err(AppError::timer_not_running());
    }
    super::todo::soft_delete_for_saved_record(&mut tx, active.id, now).await?;
    tx.commit().await?;
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

/// 丢弃 active 会话：置 saved + 折入累计 + ended_at + 软删除（释放单 active 唯一槽，R-5）。
///
/// `accumulated_sec` 必须由调用方给出真实值（`live_duration`）：早先这里不写这一列，
/// 被丢弃的行会留下「`accumulated_sec=0` 却 `ended_at - started_at = 12 分钟`」的脏数据。
/// 当前所有查询都过滤 `deleted_at`，所以它暂时不可见——但一旦有人写"回收站 / 统计全量"
/// 就会读到假数据。软删不等于可以留脏值。
pub async fn discard(
    pool: &SqlitePool,
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
    .execute(pool)
    .await?;
    Ok(())
}

/// 分段换事项：事务内结束旧会话并新开一条 active，返回新 id。
///
/// `discard_old = true` 时旧会话按**软删**处理（`deleted_at` 落盘、不联动待办）：
/// 调用方判定旧段短于「最短记录时长」，这段不该出现在记录列表里（ADR-023）。
/// 两条路径都写真实的 `accumulated_sec`——软删不等于可以留脏值。
///
/// 无论旧段留下还是被丢弃，新会话都照常创建：切换事项不能因为旧段太短而中断。
pub async fn end_and_start(
    pool: &SqlitePool,
    old_id: i64,
    new_item_id: i64,
    accumulated_sec: i64,
    ended_at: i64,
    now: i64,
    discard_old: bool,
) -> AppResult<i64> {
    let mut tx = pool.begin().await?;
    let deleted_at: Option<i64> = if discard_old { Some(now) } else { None };
    let saved = sqlx::query(
        "UPDATE time_records \
         SET status = 'saved', ended_at = ?, accumulated_sec = ?, running_since = NULL, \
             deleted_at = ?, updated_at = ? \
         WHERE id = ? AND status = 'active' AND deleted_at IS NULL",
    )
    .bind(ended_at)
    .bind(accumulated_sec)
    .bind(deleted_at)
    .bind(now)
    .bind(old_id)
    .execute(&mut *tx)
    .await?;
    if saved.rows_affected() != 1 {
        // 旧会话已不在 active（并发结束）：不要用新分段掩盖掉这次失败
        return Err(AppError::timer_not_running());
    }
    if !discard_old {
        super::todo::soft_delete_for_saved_record(&mut tx, old_id, now).await?;
    }
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
