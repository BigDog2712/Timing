mod buckets;
mod catalog;
mod daily;
mod facts;
mod hourly;
mod hourly_write;
mod worker;
pub(crate) use hourly::load_range_in_tx;
pub(crate) use worker::{spawn_background_worker, wake_worker, ReadModelWake};
/* 后台维护的调度器只被用例实例化（生产侧由 `spawn_background_worker` 自己持有），
所以回挂成 `#[cfg(test)]`，否则 lib 构建会报 unused import。 */
use buckets::{aggregate_records_into_boundaries, validate_aggregate_boundaries};
#[cfg(test)]
pub(crate) use worker::{record_maintenance_failure, MaintenanceSchedule};

#[cfg(test)]
mod app_key_equivalence_tests;
#[cfg(test)]
mod bucket_union_tests;
#[cfg(test)]
mod contention_tests;
#[cfg(test)]
mod daily_tests;
#[cfg(test)]
mod name_enrichment_tests;

use crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool;
/* 只给 `mod_mod_tests` 用（它经 `use super::*` 取）：统计优化已搬进 `worker.rs`。 */
#[cfg(test)]
use crate::services::activity::data::sqlite_pool::optimize_query_statistics;
use serde::{Deserialize, Serialize};
/* 只给 `mod_mod_tests` 用（它经 `use super::*` 取）：测试文件已冻结在行数上，
搬出去的桶裁剪函数不再需要它，但用例里还在用它做对照表。 */
#[cfg(test)]
use std::collections::BTreeMap;
/* 只给 `contention_tests` 用（它经 `use super::*` 取）：`Duration` 原本是 `mod.rs`
自己的导入，后台维护搬走之后 lib 构建不需要它了。 */
use sqlx::{Pool, Row, Sqlite};
use tauri::{AppHandle, Runtime};
#[cfg(test)]
use tokio::time::Duration;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogCursorDto {
    pub last_seen_ms: i64,
    pub raw_exe_name: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogRowDto {
    pub raw_exe_name: String,
    pub app_name: String,
    pub last_seen_ms: i64,
    pub has_native_records: bool,
    pub has_import_exact_records: bool,
    pub has_import_bucket_records: bool,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordedAppCatalogPageDto {
    pub rows: Vec<RecordedAppCatalogRowDto>,
    pub next_cursor: Option<RecordedAppCatalogCursorDto>,
    pub has_more: bool,
    pub read_path: &'static str,
    pub fallback_reason: Option<&'static str>,
    pub source_revision: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAggregateRecordDto {
    pub anonymous: bool,
    pub app_name: String,
    pub exe_name: String,
    /// 归属设备（设计 §6.1）。读路径**永远不产出空串**：迁移期哨兵在事实 SQL 里就被
    /// `COALESCE(NULLIF(TRIM(device_id), ''), <本机 id>)` 折成本机，投影行则由写侧保证。
    /// 单设备时前端拿它只是为了"数一数有几台"，**不上界面**（§6.5）。
    pub device_id: String,
    pub start_time: i64,
    pub end_time: i64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityAggregateRangeDto {
    #[serde(skip)]
    pub(crate) maintenance_pending: bool,
    pub records: Vec<ActivityAggregateRecordDto>,
    /// 逐桶并集（`跨设备去重 + 设备内加总`），长度 = 桶数；没有桶边界时为 `[]`。
    ///
    /// 为什么后端算而不是前端算：桶里的**位置信息**在 `records` 里已经没了
    /// （每条都被压成"起点 = 桶起点、长度 = 该桶时长"），前端没法再求并集。
    /// 两台设备在同一小时各 30 分钟重叠时，这里给 30 分钟，而 `records` 加起来是 60。
    pub bucket_union_ms: Vec<i64>,
    pub read_path: &'static str,
    pub fallback_reason: Option<&'static str>,
    pub source_revision: i64,
    pub projection_row_count: usize,
    pub fact_row_count: usize,
    pub has_active_session: bool,
}

/// 一天的「某台设备自己的墙钟」（P2 才会展示，P1 只保证字段在）。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyDeviceTotalDto {
    pub device_id: String,
    pub union_ms: i64,
}

/// 一天的日级双口径。
///
/// 主指标是 `union_ms`（≤ 24h，可以画进度条）；`device_sum_ms` 可 > 24h，
/// **只许**出现在历史页（design §6.5）。单设备时两者恒等。
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyTotalsDto {
    pub day_key: String,
    pub union_ms: i64,
    pub device_sum_ms: i64,
    pub device_count: i64,
    pub devices: Vec<DailyDeviceTotalDto>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReadModelStatusDto {
    pub source_revision: i64,
    pub app_catalog_state: String,
    pub activity_hourly_state: String,
    pub activity_coverage_start_ms: Option<i64>,
    pub activity_coverage_end_ms: Option<i64>,
    pub dirty_app_count: i64,
    pub dirty_range_count: i64,
}

pub async fn load_recorded_app_catalog_page<R: Runtime>(
    app: &AppHandle<R>,
    cursor: Option<RecordedAppCatalogCursorDto>,
    search_query: String,
    limit: usize,
) -> Result<RecordedAppCatalogPageDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    catalog::load_page(&pool, cursor, search_query, limit).await
}

pub async fn load_activity_aggregate_range<R: Runtime>(
    app: &AppHandle<R>,
    start_ms: i64,
    end_ms: i64,
    bucket_boundaries_ms: Option<Vec<i64>>,
) -> Result<ActivityAggregateRangeDto, String> {
    if end_ms <= start_ms {
        return Ok(ActivityAggregateRangeDto {
            maintenance_pending: false,
            records: Vec::new(),
            bucket_union_ms: Vec::new(),
            read_path: "projection",
            fallback_reason: None,
            source_revision: 0,
            projection_row_count: 0,
            fact_row_count: 0,
            has_active_session: false,
        });
    }
    if let Some(boundaries) = bucket_boundaries_ms.as_deref() {
        validate_aggregate_boundaries(start_ms, end_ms, boundaries)?;
    }
    let pool = wait_for_sqlite_pool(app).await?;
    let mut response = hourly::load_range(
        &pool,
        start_ms,
        end_ms,
        bucket_boundaries_ms.as_deref().unwrap_or(&[]),
    )
    .await?;
    if response.maintenance_pending {
        wake_worker(app);
    }
    if let Some(boundaries) = bucket_boundaries_ms {
        /* 并集要在**未聚合**的 records 上算：`aggregate_records_into_boundaries` 把每条
        压成「起点 = 桶起点」，位置一丢就再也分不清「两台机器各 30 分钟」与「叠着 30 分钟」。 */
        response.bucket_union_ms =
            facts::bucket_unions(&pool, start_ms, end_ms, &boundaries, &response.records).await?;
        response.records =
            aggregate_records_into_boundaries(response.records, start_ms, end_ms, &boundaries)?;
    }
    Ok(response)
}

/// 读一批本地日的日级双口径。今天由纯函数现算（不落表），其余读 `activity_daily_totals`。
pub async fn load_activity_daily_totals<R: Runtime>(
    app: &AppHandle<R>,
    day_keys: Vec<String>,
) -> Result<Vec<DailyTotalsDto>, String> {
    if day_keys.is_empty() {
        return Ok(Vec::new());
    }
    let pool = wait_for_sqlite_pool(app).await?;
    daily::load_range(&pool, &day_keys, now_ms()).await
}

pub async fn load_status<R: Runtime>(app: &AppHandle<R>) -> Result<ReadModelStatusDto, String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let row = sqlx::query(
        "SELECT
            (SELECT source_revision FROM read_model_revision WHERE id = 1) source_revision,
            (SELECT state FROM read_model_state WHERE model_name = 'app_catalog') app_catalog_state,
            (SELECT state FROM read_model_state WHERE model_name = 'activity_hourly') activity_hourly_state,
            (SELECT coverage_start_ms FROM read_model_state WHERE model_name = 'activity_hourly') activity_coverage_start_ms,
            (SELECT coverage_end_ms FROM read_model_state WHERE model_name = 'activity_hourly') activity_coverage_end_ms,
            (SELECT COUNT(*) FROM app_catalog_dirty_keys) dirty_app_count,
            (SELECT COUNT(*) FROM activity_summary_dirty_ranges) dirty_range_count",
    )
    .fetch_one(&pool)
    .await
    .map_err(|error| format!("failed to read activity model status: {error}"))?;
    Ok(ReadModelStatusDto {
        source_revision: row.get("source_revision"),
        app_catalog_state: row.get("app_catalog_state"),
        activity_hourly_state: row.get("activity_hourly_state"),
        activity_coverage_start_ms: row.get("activity_coverage_start_ms"),
        activity_coverage_end_ms: row.get("activity_coverage_end_ms"),
        dirty_app_count: row.get("dirty_app_count"),
        dirty_range_count: row.get("dirty_range_count"),
    })
}

pub async fn invalidate_all(pool: &Pool<Sqlite>, reason: &'static str) -> Result<(), String> {
    let now_ms = now_ms();
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin read model invalidation: {error}"))?;
    sqlx::query(
        "UPDATE read_model_state
         SET state = 'invalid', coverage_start_ms = NULL, coverage_end_ms = NULL,
             backfill_cursor_ms = NULL, last_error_code = ?, updated_at_ms = ?",
    )
    .bind(reason)
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to invalidate activity read models: {error}"))?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit read model invalidation: {error}"))
}

pub(crate) async fn maintain_once(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let _timing = crate::services::activity::data::sqlite_pool::diagnostics::start(
        crate::services::activity::data::sqlite_pool::diagnostics::Phase::ReadModel,
    );
    if catalog::maintain_once(pool).await? {
        return Ok(true);
    }
    hourly::maintain_once(pool).await
}

pub(crate) fn now_ms() -> i64 {
    crate::infra::activity::clock::unix_timestamp_millis_i64()
}

#[cfg(test)]
#[path = "mod_mod_tests.rs"]
mod tests;
