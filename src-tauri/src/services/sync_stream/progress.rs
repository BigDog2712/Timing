//! 事件流的「传到哪了」只读投影（设置页状态行用）。**不跑同步、不发请求**。
//!
//! ## 为什么状态不能再看 `md_cloud_pending`
//!
//! 「今天已上传」原来是「今天那份 md 写了、并记了指纹」。停写 md 之后这条记录不再产生，
//! 照旧读它会让设置页**永远显示「今天还没上传」**——一个看着像网络故障的假象。
//! 所以状态改由事件流自己回答，只有两个数：
//!
//! - 本机事件的最大 `id`（上传游标的上界）；
//! - 当前目标的上传游标 `sync_target_cursor[scope, 本机 device_id].last_op_id`。
//!
//! 两者相等 ⇒ 本机产生的每一条事件都已经写进落点；`id > 游标` 的行存在 ⇒ 还有没传的。
//!
//! ## 「今天已上传」的准确含义
//!
//! 今天**有事件**且今天的事件都已传上去。今天一条事件都没有时返回 `false`（「今天还没
//! 上传」）——这与 md 时代「今天没写就没有那份」同一口径，不把「无事可传」粉饰成已完成。

use sqlx::{Row, SqlitePool};

use crate::error::{AppError, AppResult};

/// 本机事件的上传进度。
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Progress {
    /// 已产生、尚未写进落点的事件所在日期（升序、去重）。
    pub pending_days: Vec<String>,
    /// 今天有事件、且今天的事件都已写进落点。
    pub pushed_today: bool,
}

/// 读本机（`device_id`）的上传进度。`None` / 空串 = 身份还没建立，一切按「没有」算。
pub async fn progress(
    pool: &SqlitePool,
    scope: &str,
    device_id: Option<&str>,
    today: &str,
) -> AppResult<Progress> {
    let Some(device_id) = device_id.filter(|id| !id.trim().is_empty()) else {
        return Ok(Progress::default());
    };
    let cursor: i64 = sqlx::query_scalar(
        "SELECT last_op_id FROM sync_target_cursor WHERE scope = ?1 AND device_id = ?2",
    )
    .bind(super::scope::upload(scope))
    .bind(device_id)
    .fetch_optional(pool)
    .await
    .map_err(AppError::db)?
    .unwrap_or(0);

    /* 端点对齐：只有「本机产生的、带 uid 的」事件才会被 push（`push.rs::load_new_ops`
    的两条过滤条件），这里必须逐字沿用，否则状态会比真实传输乐观。 */
    let rows = sqlx::query(
        "SELECT day_key, MAX(id) AS max_id
           FROM timer_ops
          WHERE device_id = ?1 AND uid IS NOT NULL AND id > ?2
          GROUP BY day_key
          ORDER BY day_key",
    )
    .bind(device_id)
    .bind(cursor)
    .fetch_all(pool)
    .await
    .map_err(AppError::db)?;

    let pending_days: Vec<String> = rows.iter().map(|row| row.get("day_key")).collect();
    let today_has_events: i64 = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM timer_ops
                        WHERE device_id = ?1 AND uid IS NOT NULL AND day_key = ?2)",
    )
    .bind(device_id)
    .bind(today)
    .fetch_one(pool)
    .await
    .map_err(AppError::db)?;

    Ok(Progress {
        pushed_today: today_has_events != 0 && !pending_days.iter().any(|day| day == today),
        pending_days,
    })
}
