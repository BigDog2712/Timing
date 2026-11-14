//! 计时会话的结束与「跨零点拆分落库」。
//!
//! 从 `record_session.rs` 拆出（单文件 ≤300 行纪律，同 `timer.rs` 拆 `timer_stop` 的做法）：
//! `record_session::finalize` / `finalize_split` 在此 re-export，调用点写法不变。
//!
//! 两者是「结束一条会话」的两条路径：不跨天走 [`finalize`]（一次 UPDATE），
//! 跨天走 [`finalize_split`]（前面各段 INSERT + 最后一段复用原行 id）。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};
use crate::models::record::TimeRecord;

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
    /* 拆出来的每一段都要带 device_id：uid（`t:<device>:<id>`）靠 AFTER INSERT 触发器按它发，
       漏写就是「这一段永远不同步」，而且零报错。 */
    let device_id = crate::services::identity::install_id().unwrap_or_default();
    for (start, end, accum) in &segments[..segments.len() - 1] {
        sqlx::query(
            "INSERT INTO time_records \
             (item_id, status, started_at, ended_at, accumulated_sec, running_since, \
              mode, target_sec, created_at, updated_at, device_id) \
             VALUES (?, 'saved', ?, ?, ?, NULL, ?, NULL, ?, ?, ?)",
        )
        .bind(active.item_id)
        .bind(start)
        .bind(end)
        .bind(accum)
        .bind(&active.mode)
        .bind(now)
        .bind(now)
        .bind(device_id)
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
