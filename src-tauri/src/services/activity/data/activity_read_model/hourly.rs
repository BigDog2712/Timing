use super::facts::{
    active_anonymous_start, active_session_start, fact_bounds, load_fact_candidates,
    local_device_id,
};
use super::hourly_write::replace_projection_range;
use super::{now_ms, ActivityAggregateRangeDto, ActivityAggregateRecordDto};
use crate::models::activity::activity_read_model::{
    ceil_to_hour, floor_to_hour, resolve_activity_precedence,
    ANONYMOUS_ACTIVITY_KEY as ANONYMOUS_APP_KEY, HOUR_MS,
};
use sqlx::{Pool, Row, Sqlite, Transaction};
/* 只给用例用（它们经 `use super::*` 取）：事实候选读取改成 `facts::load_fact_candidates` 之后
本文件不再直接引用，但 `contract_tests` / `benchmark` 还在做 query-plan 断言。 */
#[cfg(test)]
use super::facts::{fact_candidates_query, ACTIVE_SESSION_START_SQL, FACT_CANDIDATES_SQL};
#[cfg(test)]
use crate::models::activity::activity_read_model::ActivityOrigin;
#[cfg(test)]
use std::collections::BTreeMap;

// 2 = 迁移 28 之后：小时表主键含 `device_id`，旧投影必须整体重建（design §T03）。
const HOURLY_SCHEMA_VERSION: i64 = 2;
const HOURLY_ALGORITHM_VERSION: i64 = 3;
const HOURLY_FINGERPRINT: &str = "epoch-hour-v1";
const BACKFILL_BATCH_MS: i64 = 7 * 24 * HOUR_MS;
const DIRTY_REBUILD_BATCH_SIZE: i64 = 128;
const PROJECTION_RANGE_SQL: &str =
    "SELECT bucket_start_ms, bucket_end_ms, app_key, raw_exe_name, display_app_name,
            effective_duration_ms, device_id
     FROM activity_hourly_effective
     WHERE bucket_start_ms >= ? AND bucket_start_ms < ? AND bucket_end_ms > ?
     ORDER BY bucket_start_ms ASC, app_key ASC, origin ASC, source_id ASC";

#[derive(Clone, Copy, Debug)]
struct Interval {
    start_ms: i64,
    end_ms: i64,
}

pub(super) async fn maintain_once(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let state = sqlx::query(
        "SELECT schema_version, algorithm_version, timezone_fingerprint, state,
                backfill_cursor_ms, coverage_end_ms
         FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to inspect hourly activity state: {error}"))?;
    let compatible = state.get::<i64, _>("schema_version") == HOURLY_SCHEMA_VERSION
        && state.get::<i64, _>("algorithm_version") == HOURLY_ALGORITHM_VERSION
        && state.get::<String, _>("timezone_fingerprint") == HOURLY_FINGERPRINT;
    let state_name: String = state.get("state");
    if !compatible || matches!(state_name.as_str(), "invalid" | "failed") {
        initialize_backfill(pool).await?;
        return Ok(true);
    }
    if state_name == "building" {
        let cursor: Option<i64> = state.get("backfill_cursor_ms");
        let target_end: Option<i64> = state.get("coverage_end_ms");
        if let (Some(cursor), Some(target_end)) = (cursor, target_end) {
            if cursor < target_end {
                process_backfill_batch(pool, cursor, target_end).await?;
            } else {
                finish_backfill(pool).await?;
            }
        } else {
            finish_backfill(pool).await?;
        }
        return Ok(true);
    }

    let dirty_rows = sqlx::query(
        "SELECT id, start_ms, end_ms, generation
         FROM activity_summary_dirty_ranges
         ORDER BY generation ASC, start_ms ASC, id ASC LIMIT ?",
    )
    .bind(DIRTY_REBUILD_BATCH_SIZE)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to select dirty activity ranges: {error}"))?;
    if !dirty_rows.is_empty() {
        let dirty = dirty_rows
            .into_iter()
            .map(|row| DirtyWork {
                id: row.get("id"),
                start_ms: row.get("start_ms"),
                end_ms: row.get("end_ms"),
                generation: row.get("generation"),
            })
            .collect();
        process_dirty_ranges(pool, dirty).await?;
        return Ok(true);
    }
    Ok(false)
}

async fn initialize_backfill(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill initialization: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    let (bounds_start_ms, bounds_end_ms) = fact_bounds(&mut tx).await?;
    let start_ms = bounds_start_ms.map(floor_to_hour);
    let end_ms = bounds_end_ms.map(ceil_to_hour);
    let timestamp_ms = now_ms();
    sqlx::query("DELETE FROM activity_hourly_effective")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear hourly projection for rebuild: {error}"))?;
    // 日级表是小时表的派生物：小时投影整体重建时必须跟着清空，否则增量重算会以为覆盖还在。
    sqlx::query("DELETE FROM activity_daily_totals")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear daily totals for rebuild: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET schema_version = ?, algorithm_version = ?, timezone_fingerprint = ?,
             state = 'building', coverage_start_ms = ?, coverage_end_ms = ?,
             backfill_cursor_ms = ?, backfill_target_revision = ?,
             last_error_code = NULL, updated_at_ms = ?
         WHERE model_name = 'activity_hourly'",
    )
    .bind(HOURLY_SCHEMA_VERSION)
    .bind(HOURLY_ALGORITHM_VERSION)
    .bind(HOURLY_FINGERPRINT)
    .bind(start_ms)
    .bind(end_ms)
    .bind(start_ms)
    .bind(source_revision)
    .bind(timestamp_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark hourly projection building: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill initialization: {error}"))
}

async fn process_backfill_batch(
    pool: &Pool<Sqlite>,
    cursor_ms: i64,
    target_end_ms: i64,
) -> Result<(), String> {
    let batch_end_ms = (cursor_ms + BACKFILL_BATCH_MS).min(target_end_ms);
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill batch: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    replace_projection_range(&mut tx, cursor_ms, batch_end_ms, source_revision).await?;
    sqlx::query(
        "UPDATE read_model_state
         SET backfill_cursor_ms = ?, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'building' AND backfill_cursor_ms = ?",
    )
    .bind(batch_end_ms)
    .bind(now_ms())
    .bind(cursor_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to advance hourly backfill cursor: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill batch: {error}"))
}

async fn finish_backfill(pool: &Pool<Sqlite>) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin hourly backfill completion: {error}"))?;
    let source_revision = current_revision(&mut tx).await?;
    let target_revision = sqlx::query_scalar::<_, i64>(
        "SELECT backfill_target_revision FROM read_model_state
         WHERE model_name = 'activity_hourly'",
    )
    .fetch_one(&mut *tx)
    .await
    .map_err(|error| format!("failed to read hourly backfill target revision: {error}"))?;
    sqlx::query("DELETE FROM activity_summary_dirty_ranges WHERE generation <= ?")
        .bind(target_revision)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear covered backfill dirty ranges: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET state = 'ready', backfill_cursor_ms = NULL,
             last_success_revision = ?, last_error_code = NULL, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'building'",
    )
    .bind(source_revision)
    .bind(now_ms())
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to mark hourly projection ready: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit hourly backfill completion: {error}"))
}

#[derive(Clone, Copy, Debug)]
struct DirtyWork {
    id: i64,
    start_ms: i64,
    end_ms: i64,
    generation: i64,
}

#[cfg(test)]
async fn process_dirty_batch(
    pool: &Pool<Sqlite>,
    dirty_id: i64,
    start_ms: i64,
    end_ms: i64,
    generation: i64,
) -> Result<(), String> {
    process_dirty_ranges(
        pool,
        vec![DirtyWork {
            id: dirty_id,
            start_ms,
            end_ms,
            generation,
        }],
    )
    .await
}

async fn process_dirty_ranges(
    pool: &Pool<Sqlite>,
    requested: Vec<DirtyWork>,
) -> Result<(), String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin dirty activity rebuild: {error}"))?;
    let mut selected = Vec::with_capacity(requested.len());
    for dirty in requested {
        let current = sqlx::query(
            "SELECT start_ms, end_ms, generation
             FROM activity_summary_dirty_ranges WHERE id = ?",
        )
        .bind(dirty.id)
        .fetch_optional(&mut *tx)
        .await
        .map_err(|error| format!("failed to recheck dirty activity generation: {error}"))?;
        if current.is_some_and(|current| {
            current.get::<i64, _>("start_ms") == dirty.start_ms
                && current.get::<i64, _>("end_ms") == dirty.end_ms
                && current.get::<i64, _>("generation") == dirty.generation
        }) {
            selected.push(dirty);
        }
    }
    if selected.is_empty() {
        tx.rollback()
            .await
            .map_err(|error| format!("failed to close stale dirty rebuild: {error}"))?;
        return Ok(());
    }
    let source_revision = current_revision(&mut tx).await?;
    let coverage_start_ms = selected
        .iter()
        .map(|dirty| dirty.start_ms)
        .min()
        .unwrap_or(0);
    let mut coverage_end_ms = coverage_start_ms;
    let rebuild_intervals = selected
        .iter()
        .map(|dirty| {
            let batch_end_ms = (dirty.start_ms + BACKFILL_BATCH_MS).min(dirty.end_ms);
            coverage_end_ms = coverage_end_ms.max(batch_end_ms);
            Interval {
                start_ms: dirty.start_ms,
                end_ms: batch_end_ms,
            }
        })
        .collect::<Vec<_>>();
    for interval in merge_intervals(rebuild_intervals, coverage_start_ms, coverage_end_ms) {
        replace_projection_range(&mut tx, interval.start_ms, interval.end_ms, source_revision)
            .await?;
    }
    for dirty in selected {
        let batch_end_ms = (dirty.start_ms + BACKFILL_BATCH_MS).min(dirty.end_ms);
        if batch_end_ms == dirty.end_ms {
            sqlx::query(
                "DELETE FROM activity_summary_dirty_ranges WHERE id = ? AND generation = ?",
            )
            .bind(dirty.id)
            .bind(dirty.generation)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to clear dirty activity generation: {error}"))?;
        } else {
            sqlx::query(
                "UPDATE activity_summary_dirty_ranges SET start_ms = ?
                 WHERE id = ? AND generation = ? AND start_ms = ?",
            )
            .bind(batch_end_ms)
            .bind(dirty.id)
            .bind(dirty.generation)
            .bind(dirty.start_ms)
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to advance dirty activity range: {error}"))?;
        }
    }
    sqlx::query(
        "UPDATE read_model_state
         SET coverage_start_ms = CASE
               WHEN coverage_start_ms IS NULL THEN ? ELSE MIN(coverage_start_ms, ?) END,
             coverage_end_ms = CASE
               WHEN coverage_end_ms IS NULL THEN ? ELSE MAX(coverage_end_ms, ?) END,
             last_success_revision = ?, updated_at_ms = ?
         WHERE model_name = 'activity_hourly' AND state = 'ready'",
    )
    .bind(coverage_start_ms)
    .bind(coverage_start_ms)
    .bind(coverage_end_ms)
    .bind(coverage_end_ms)
    .bind(source_revision)
    .bind(now_ms())
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to update hourly coverage after dirty rebuild: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit dirty activity rebuild: {error}"))
}

pub(super) async fn load_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: &[i64],
) -> Result<ActivityAggregateRangeDto, String> {
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin activity aggregate read: {error}"))?;
    let result =
        load_range_in_tx(&mut tx, start_ms, end_ms, bucket_boundaries_ms, now_ms()).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to finish activity aggregate read: {error}"))?;
    Ok(result)
}

pub(crate) async fn load_range_in_tx(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: &[i64],
    sampled_at_ms: i64,
) -> Result<ActivityAggregateRangeDto, String> {
    let state_result = sqlx::query(
        "SELECT state, schema_version, algorithm_version, timezone_fingerprint,
                coverage_start_ms, coverage_end_ms,
                (SELECT source_revision FROM read_model_revision WHERE id = 1) source_revision
         FROM read_model_state WHERE model_name = 'activity_hourly'",
    )
    .fetch_optional(&mut **tx)
    .await;
    let (ready, coverage_start, coverage_end, source_revision) = match state_result {
        Ok(Some(state)) => (
            state.get::<String, _>("state") == "ready"
                && state.get::<i64, _>("schema_version") == HOURLY_SCHEMA_VERSION
                && state.get::<i64, _>("algorithm_version") == HOURLY_ALGORITHM_VERSION
                && state.get::<String, _>("timezone_fingerprint") == HOURLY_FINGERPRINT,
            state.get::<Option<i64>, _>("coverage_start_ms"),
            state.get::<Option<i64>, _>("coverage_end_ms"),
            state.get::<i64, _>("source_revision"),
        ),
        Ok(None) | Err(_) => (false, None, None, 0),
    };
    // 迁移 28 之后每台设备都可以各有一条进行中的会话，探针因此是 `MIN(start_time)`。
    let active_start = active_session_start(tx)
        .await?
        .filter(|active_start| *active_start < end_ms);
    let anonymous_start = active_anonymous_start(tx)
        .await?
        .filter(|start| *start < end_ms);
    let active_start = active_start.into_iter().chain(anonymous_start).min();

    let mut fact_intervals = Vec::new();
    let mut maintenance_pending = !ready;
    let mut outside_projection_coverage = false;
    if !ready {
        fact_intervals.push(Interval { start_ms, end_ms });
    } else {
        if start_ms.rem_euclid(HOUR_MS) != 0 {
            fact_intervals.push(Interval {
                start_ms,
                end_ms: end_ms.min(ceil_to_hour(start_ms)),
            });
        }
        if end_ms.rem_euclid(HOUR_MS) != 0 {
            fact_intervals.push(Interval {
                start_ms: start_ms.max(floor_to_hour(end_ms)),
                end_ms,
            });
        }
        for boundary_ms in bucket_boundaries_ms {
            if boundary_ms.rem_euclid(HOUR_MS) != 0 {
                fact_intervals.push(Interval {
                    start_ms: floor_to_hour(*boundary_ms),
                    end_ms: ceil_to_hour(*boundary_ms),
                });
            }
        }
        match (coverage_start, coverage_end) {
            (Some(coverage_start), Some(coverage_end)) => {
                if start_ms < coverage_start {
                    outside_projection_coverage = true;
                    fact_intervals.push(Interval {
                        start_ms,
                        end_ms: end_ms.min(coverage_start),
                    });
                }
                if end_ms > coverage_end {
                    outside_projection_coverage = true;
                    fact_intervals.push(Interval {
                        start_ms: start_ms.max(coverage_end),
                        end_ms,
                    });
                }
            }
            _ => {
                outside_projection_coverage = true;
                fact_intervals.push(Interval { start_ms, end_ms });
            }
        }
        let dirty_rows = sqlx::query(
            "SELECT start_ms, end_ms FROM activity_summary_dirty_ranges
             WHERE start_ms < ? AND end_ms > ? ORDER BY start_ms ASC",
        )
        .bind(end_ms)
        .bind(start_ms)
        .fetch_all(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect dirty activity overlaps: {error}"))?;
        maintenance_pending |= !dirty_rows.is_empty();
        for dirty in dirty_rows {
            fact_intervals.push(Interval {
                start_ms: start_ms.max(dirty.get("start_ms")),
                end_ms: end_ms.min(dirty.get("end_ms")),
            });
        }
        if let Some(active_start) = active_start {
            let active_end = sampled_at_ms.min(end_ms);
            if active_end > start_ms.max(active_start) {
                fact_intervals.push(Interval {
                    start_ms: start_ms.max(floor_to_hour(active_start)),
                    end_ms: end_ms.min(ceil_to_hour(active_end)),
                });
            }
        }
    }
    let mut fact_intervals = merge_intervals(fact_intervals, start_ms, end_ms);

    let mut projection_unavailable = false;
    let projection_rows = if ready {
        match sqlx::query(PROJECTION_RANGE_SQL)
            .bind(floor_to_hour(start_ms))
            .bind(end_ms)
            .bind(start_ms)
            .fetch_all(&mut **tx)
            .await
        {
            Ok(rows) => rows,
            Err(error) => {
                projection_unavailable = true;
                fact_intervals = vec![Interval { start_ms, end_ms }];
                let _ = sqlx::query(
                    "UPDATE read_model_state
                     SET state = 'invalid', last_error_code = 'projection_read_failed',
                         updated_at_ms = ?
                     WHERE model_name = 'activity_hourly'",
                )
                .bind(sampled_at_ms)
                .execute(&mut **tx)
                .await;
                crate::log_warn!("hourly projection unavailable; using facts: {error}");
                Vec::new()
            }
        }
    } else {
        Vec::new()
    };
    let mut records = Vec::new();
    let mut projection_row_count = 0;
    for row in projection_rows {
        let bucket_start_ms: i64 = row.get("bucket_start_ms");
        let bucket_end_ms: i64 = row.get("bucket_end_ms");
        if overlaps_any(&fact_intervals, bucket_start_ms, bucket_end_ms) {
            continue;
        }
        let duration_ms: i64 = row.get("effective_duration_ms");
        records.push(ActivityAggregateRecordDto {
            anonymous: row.get::<String, _>("app_key") == ANONYMOUS_APP_KEY,
            app_name: row.get("display_app_name"),
            exe_name: if row.get::<String, _>("app_key") == ANONYMOUS_APP_KEY {
                String::new()
            } else {
                row.get("raw_exe_name")
            },
            device_id: row.get("device_id"),
            start_time: bucket_start_ms,
            end_time: bucket_start_ms + duration_ms,
        });
        projection_row_count += 1;
    }

    let mut fact_row_count = 0;
    // 事实支路的「本机」身份：只在没有事实区间时省掉这次查库。
    let device_id = if fact_intervals.is_empty() {
        String::new()
    } else {
        local_device_id(tx).await?
    };
    for interval in &fact_intervals {
        let candidates = load_fact_candidates(
            tx,
            interval.start_ms,
            interval.end_ms,
            false,
            sampled_at_ms,
            &device_id,
        )
        .await?;
        for range in resolve_activity_precedence(&candidates) {
            let clipped_start = range.start_ms.max(interval.start_ms);
            let clipped_end = range.end_ms.min(interval.end_ms);
            if clipped_end <= clipped_start {
                continue;
            }
            records.push(ActivityAggregateRecordDto {
                anonymous: range.value.anonymous,
                app_name: range.value.app_name,
                exe_name: range.value.exe_name,
                device_id: range.value.device_id.clone(),
                start_time: clipped_start,
                end_time: clipped_end,
            });
            fact_row_count += 1;
        }
    }
    records.sort_by(|left, right| {
        left.start_time
            .cmp(&right.start_time)
            .then_with(|| left.exe_name.cmp(&right.exe_name))
            .then_with(|| left.end_time.cmp(&right.end_time))
    });

    let fallback_reason = if fact_intervals.is_empty() {
        None
    } else if projection_unavailable {
        Some("projection_unavailable")
    } else if !ready {
        Some("model_not_ready")
    } else if outside_projection_coverage {
        Some("outside_projection_coverage")
    } else {
        Some("partial_dirty_or_active")
    };
    Ok(ActivityAggregateRangeDto {
        maintenance_pending: maintenance_pending || projection_unavailable,
        records,
        bucket_union_ms: Vec::new(),
        read_path: if fact_intervals.is_empty() {
            "projection"
        } else if projection_row_count == 0 {
            "facts"
        } else {
            "hybrid"
        },
        fallback_reason,
        source_revision,
        projection_row_count,
        fact_row_count,
        has_active_session: active_start.is_some(),
    })
}

fn merge_intervals(mut intervals: Vec<Interval>, start_ms: i64, end_ms: i64) -> Vec<Interval> {
    for interval in &mut intervals {
        interval.start_ms = interval.start_ms.max(start_ms);
        interval.end_ms = interval.end_ms.min(end_ms);
    }
    intervals.retain(|interval| interval.end_ms > interval.start_ms);
    intervals.sort_by_key(|interval| (interval.start_ms, interval.end_ms));
    let mut merged: Vec<Interval> = Vec::new();
    for interval in intervals {
        if let Some(previous) = merged.last_mut() {
            if interval.start_ms <= previous.end_ms {
                previous.end_ms = previous.end_ms.max(interval.end_ms);
                continue;
            }
        }
        merged.push(interval);
    }
    merged
}

fn overlaps_any(intervals: &[Interval], start_ms: i64, end_ms: i64) -> bool {
    intervals
        .iter()
        .any(|interval| interval.start_ms < end_ms && interval.end_ms > start_ms)
}

async fn current_revision(tx: &mut Transaction<'_, Sqlite>) -> Result<i64, String> {
    sqlx::query_scalar("SELECT source_revision FROM read_model_revision WHERE id = 1")
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("failed to read source revision: {error}"))
}

#[cfg(test)]
#[path = "hourly_contract_tests.rs"]
mod contract_tests;

#[cfg(test)]
#[path = "hourly_recovery_tests.rs"]
mod recovery_tests;

#[cfg(test)]
#[path = "hourly_benchmark.rs"]
mod benchmark;

#[cfg(test)]
#[path = "hourly_mod_tests.rs"]
mod tests;
