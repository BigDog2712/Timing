//! 小时投影的**写**侧（事实 → `activity_hourly_effective`）。
//!
//! 从 `hourly.rs` 搬出来的理由只有一个：`hourly.rs` 正好压在 `check:size` 的
//! 冻结线上（852/852），而设备维度要往里加东西。搬的时候**一行语义都没改**——
//! 想改投影口径请改这里，别在 `hourly.rs` 里再造一份。
//!
//! 调用方只有两个（都在 `hourly.rs`）：全量回填的一批、脏区间的重建。
//!
//! ## 容量拆行（别当成 bug 删掉）
//!
//! 同一个 `(bucket, device, app_key, origin, source_id)` 的时长可能超过一小时（同一条
//! 会话跨小时、或两条重叠的原生会话），而表上有
//! `CHECK(effective_duration_ms <= bucket_end_ms - bucket_start_ms)`。
//! 所以这里按 `min(remaining, HOUR_MS)` 拆成 `native:0` / `native:1` … 多行，
//! 主键仍唯一、总和不变、也不伪造下一小时的活动。
//!
//! ## 为什么 key 里必须有 `device_id`（D3 的唯一一道墙）
//!
//! 不按设备拆 key 时，两台设备各 40 分钟会累加成 80 分钟，容量拆行**不会报错**
//! （`CHECK` 恒满足），于是时间轴上出现「一个小时用了 80 分钟」的荒谬读数。
//! 迁移 28 之后 `activity_hourly_effective` 的主键也含 `device_id`，两处必须一致。

use super::facts::{load_fact_candidates, local_device_id};
use super::now_ms;
use crate::models::activity::activity_read_model::{
    floor_to_hour, normalize_app_key, resolve_activity_precedence, ActivityOrigin,
    ANONYMOUS_ACTIVITY_KEY as ANONYMOUS_APP_KEY, HOUR_MS,
};
use sqlx::{Sqlite, Transaction};
use std::collections::BTreeMap;

/// 同一 `(bucket, device, app, origin, source)` 在**一个**小时桶里的累加器。
///
/// `latest_start_ms` 决定"用哪条事实的显示名"：同一个 app 在同一小时里可能有多个窗口
/// 标题，取时间上最后开始的那条（与旧实现逐字一致）。
#[derive(Debug)]
struct HourlyAccumulator {
    raw_exe_name: String,
    display_app_name: String,
    duration_ms: i64,
    latest_start_ms: i64,
}

/// 重算 `[start_ms, end_ms)` 这一段的小时投影：先清空再按事实重建。
///
/// 事务由调用方持有（回填与脏区间重建都是「一批一个事务」），这里不 commit。
pub(super) async fn replace_projection_range(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    source_revision: i64,
) -> Result<(), String> {
    // 事实支路的「本机」身份：`sessions.device_id` 是迁移期哨兵时回落到它，
    // 导入两支与匿名支一律记在它名下（design §6.1）。
    let fallback_device_id = local_device_id(tx).await?;
    let candidates =
        load_fact_candidates(tx, start_ms, end_ms, true, now_ms(), &fallback_device_id).await?;
    let resolved = resolve_activity_precedence(&candidates);
    // key 的第二位必须是 `device_id`：否则两台设备同一小时同一应用会被加进同一行（见文件头）。
    let mut rows: BTreeMap<(i64, String, String, ActivityOrigin, String), HourlyAccumulator> =
        BTreeMap::new();
    for range in resolved {
        let clipped_start = range.start_ms.max(start_ms);
        let clipped_end = range.end_ms.min(end_ms);
        if clipped_end <= clipped_start {
            continue;
        }
        let Some(app_key) = (if range.value.anonymous {
            Some(ANONYMOUS_APP_KEY.to_string())
        } else {
            normalize_app_key(&range.value.exe_name)
        }) else {
            continue;
        };
        let mut cursor_ms = clipped_start;
        while cursor_ms < clipped_end {
            let bucket_start_ms = floor_to_hour(cursor_ms);
            let bucket_end_ms = bucket_start_ms + HOUR_MS;
            let segment_end_ms = clipped_end.min(bucket_end_ms);
            let duration_ms = segment_end_ms - cursor_ms;
            if duration_ms > 0 {
                let key = (
                    bucket_start_ms,
                    range.value.device_id.clone(),
                    app_key.clone(),
                    range.origin,
                    range.value.source_id.clone(),
                );
                let entry = rows.entry(key).or_insert_with(|| HourlyAccumulator {
                    raw_exe_name: range.value.exe_name.clone(),
                    display_app_name: range.value.app_name.trim().to_string(),
                    duration_ms: 0,
                    latest_start_ms: cursor_ms,
                });
                entry.duration_ms += duration_ms;
                if cursor_ms >= entry.latest_start_ms {
                    entry.raw_exe_name = range.value.exe_name.clone();
                    if !range.value.app_name.trim().is_empty() {
                        entry.display_app_name = range.value.app_name.trim().to_string();
                    }
                    entry.latest_start_ms = cursor_ms;
                }
            }
            cursor_ms = segment_end_ms;
        }
    }

    sqlx::query(
        "DELETE FROM activity_hourly_effective
         WHERE bucket_start_ms >= ? AND bucket_start_ms < ?",
    )
    .bind(start_ms)
    .bind(end_ms)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to clear hourly projection range: {error}"))?;
    let timestamp_ms = now_ms();
    for ((bucket_start_ms, device_id, app_key, origin, source_id), row) in rows {
        // Native facts remain additive when they overlap. Capacity rows preserve that total
        // without fabricating activity in the next hour or retaining every session identity.
        let mut remaining_ms = row.duration_ms;
        let mut capacity_index = 0;
        while remaining_ms > 0 {
            let duration_ms = remaining_ms.min(HOUR_MS);
            let row_source_id = if origin == ActivityOrigin::Native {
                format!("native:{capacity_index}")
            } else {
                source_id.clone()
            };
            sqlx::query(
                "INSERT INTO activity_hourly_effective(
                   bucket_start_ms, bucket_end_ms, device_id, app_key, raw_exe_name,
                   display_app_name, origin, source_id, effective_duration_ms, computed_revision,
                   updated_at_ms
                 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(bucket_start_ms)
            .bind(bucket_start_ms + HOUR_MS)
            .bind(&device_id)
            .bind(&app_key)
            // This derived table requires a nonempty key in its historical exe column.
            // The reserved key is never written into facts or returned as an executable.
            .bind(if app_key == ANONYMOUS_APP_KEY {
                ANONYMOUS_APP_KEY
            } else {
                &row.raw_exe_name
            })
            .bind(&row.display_app_name)
            .bind(origin.as_str())
            .bind(row_source_id)
            .bind(duration_ms)
            .bind(source_revision)
            .bind(timestamp_ms)
            .execute(&mut **tx)
            .await
            .map_err(|error| format!("failed to insert hourly projection row: {error}"))?;
            remaining_ms -= duration_ms;
            capacity_index += 1;
        }
    }
    // 日级表是小时投影的派生物：这里写完就必须跟着重算，否则日级读数会滞后一整个批次
    // （design §T04「写完小时投影后调 refresh_days」）。只重算**已关闭**的天。
    super::daily::refresh_days(tx, start_ms, end_ms, source_revision).await
}
