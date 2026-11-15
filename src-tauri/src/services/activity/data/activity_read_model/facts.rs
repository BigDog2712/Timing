//! 投影的事实候选读取（从 `hourly.rs` 搬出来，T01 的棘轮要求）。
//!
//! 搬它的**真正**理由是 T03：三条事实支路都要带出 `device_id`，SQL 与绑定列表都要变长，
//! 而 `hourly.rs` 压在 739 行的冻结线上。
//!
//! ## 每支的 `device_id` 从哪来（设计 §3.3 / §6.1）
//!
//! | 支路 | 取值 |
//! |---|---|
//! | `sessions` | 行上的 `device_id`；是迁移期哨兵 `''` 时**回落到本机** |
//! | `import_exact_sessions` / `import_time_buckets` | **本机 install_id**（导入数据算导入方自己的墙钟） |
//! | `anonymous_activity` | **本机 install_id** |
//!
//! 回落那一条不是洁癖：读路径一旦把 `''` 当成一个真实设备，界面上就会出现一个叫
//! 「空字符串」的设备，而它永远不会被认领（认领只在启动时跑一次）。导入与匿名两支
//! 也不引入 `'import'` 之类的伪设备——那会让「设备合计」多出一台不存在的机器。

use crate::models::activity::activity_read_model::{
    ceil_to_hour, floor_to_hour, resolve_activity_precedence, should_track_activity_fact,
    ActivityOrigin, OwnedActivityRange,
};
use sqlx::{Pool, Row, Sqlite, Transaction};

use super::{buckets, ActivityAggregateRecordDto};

pub(super) const FACT_CANDIDATES_SQL: &str =
    "SELECT record_id, origin, device_id, app_name, exe_name, window_title, start_ms, end_ms,
            capacity_end_ms, source_id
     FROM (
       SELECT id record_id, 'native' origin,
              COALESCE(NULLIF(TRIM(device_id), ''), ?) device_id,
              app_name, exe_name, window_title, start_time start_ms,
              COALESCE(end_time, ?) end_ms, NULL capacity_end_ms,
              'native' source_id, 0 origin_rank
       FROM sessions
       WHERE start_time < ? AND (end_time > ? OR (end_time IS NULL AND ? > ?))
         AND (? = 0 OR end_time IS NOT NULL)
       UNION ALL
       SELECT id, 'import_exact', ?, app_name, exe_name, window_title, start_time, end_time, NULL,
              batch_id, 1
       FROM import_exact_sessions WHERE start_time < ? AND end_time > ?
       UNION ALL
       SELECT id, 'import_bucket', ?, COALESCE(NULLIF(app_name, ''), exe_name), exe_name, '',
              bucket_start_time, bucket_start_time + duration,
              bucket_start_time + 3600000, batch_id, 2
       FROM import_time_buckets
       WHERE bucket_start_time < ? AND bucket_start_time + 3600000 > ?
     )
     ORDER BY start_ms ASC, origin_rank ASC, record_id ASC, end_ms ASC";

#[derive(Clone, Debug)]
pub(super) struct CandidateValue {
    pub(super) anonymous: bool,
    /// 行归属设备。命中哨兵时是本机 `install_id`（见文件头），**永远不是空串**。
    pub(super) device_id: String,
    pub(super) app_name: String,
    pub(super) exe_name: String,
    pub(super) source_id: String,
}

/// 本机 `install_id`（投影行的默认归属）。
///
/// 来源是 `devices` 的 `is_self = 1` 行，由 `services::device::ensure_self` 在
/// `prepare_pool_schema` 里 upsert。不在这里读 `install_id.txt`：投影是纯缓存，
/// 一次重算不该去碰文件系统；而且手机端没有 `services::device`。
///
/// 找不到就直接报错而不兜底写 `'local'`：`device_id` 是主键成员，写进一个假身份
/// 之后没有任何读路径能发现它错了，而报错能在启动的那一次回填里立刻暴露。
pub(super) async fn local_device_id(tx: &mut Transaction<'_, Sqlite>) -> Result<String, String> {
    sqlx::query_scalar::<_, String>(
        "SELECT install_id FROM devices WHERE is_self = 1 ORDER BY last_seen_ms DESC LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| format!("failed to read the local device id for the hourly projection: {error}"))?
    .filter(|install_id| !install_id.trim().is_empty())
    .ok_or_else(|| "the local device row is missing, so the hourly projection cannot be attributed".to_string())
}

/// 把 `FACT_CANDIDATES_SQL` 的 13 个占位符按顺序绑好。
///
/// 单独成一个函数有两个理由：① 生产侧与 `hourly_contract_tests` 的 query-plan 断言
/// 用**同一份**绑定顺序，测试不可能因为「自己另抄了一份绑定表」而碰巧绿；
/// ② `device_id` 在三支里各出现一次，散在调用点迟早会漏掉一支。
pub(super) fn fact_candidates_query<'q>(
    sql: &'q str,
    device_id: &'q str,
    start_ms: i64,
    end_ms: i64,
    closed_only: bool,
    current_ms: i64,
) -> sqlx::query::Query<'q, Sqlite, sqlx::sqlite::SqliteArguments<'q>> {
    sqlx::query(sql)
        .bind(device_id)
        .bind(current_ms)
        .bind(end_ms)
        .bind(start_ms)
        .bind(current_ms)
        .bind(start_ms)
        .bind(i64::from(closed_only))
        .bind(device_id)
        .bind(end_ms)
        .bind(start_ms)
        .bind(device_id)
        .bind(end_ms)
        .bind(start_ms)
}

pub(super) async fn load_fact_candidates(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    closed_only: bool,
    current_ms: i64,
    device_id: &str,
) -> Result<Vec<OwnedActivityRange<CandidateValue>>, String> {
    // Import buckets allocate the hour's remaining capacity. A partial query must include
    // native/exact facts elsewhere in that hour before clipping the resolved geometry.
    let start_ms = floor_to_hour(start_ms);
    let end_ms = ceil_to_hour(end_ms);
    let rows = fact_candidates_query(
        FACT_CANDIDATES_SQL,
        device_id,
        start_ms,
        end_ms,
        closed_only,
        current_ms,
    )
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to load activity facts for projection: {error}"))?;
    let mut candidates = Vec::with_capacity(rows.len());
    for row in rows {
        let app_name: String = row.get("app_name");
        let exe_name: String = row.get("exe_name");
        let window_title: String = row.get("window_title");
        if !should_track_activity_fact(&exe_name, &app_name, &window_title) {
            continue;
        }
        let origin = match row.get::<String, _>("origin").as_str() {
            "native" => ActivityOrigin::Native,
            "import_exact" => ActivityOrigin::ImportExact,
            "import_bucket" => ActivityOrigin::ImportBucket,
            value => return Err(format!("unknown activity fact origin `{value}`")),
        };
        candidates.push(OwnedActivityRange {
            origin,
            start_ms: row.get("start_ms"),
            end_ms: row.get("end_ms"),
            capacity_end_ms: row.get("capacity_end_ms"),
            value: CandidateValue {
                anonymous: false,
                device_id: row.get("device_id"),
                app_name,
                exe_name,
                source_id: row.get("source_id"),
            },
        });
    }
    for row in sqlx::query(
        "SELECT start_time, COALESCE(end_time, observed_until) end_time
        FROM anonymous_activity WHERE start_time < ? AND COALESCE(end_time, observed_until) > ?
        AND (? = 0 OR end_time IS NOT NULL)",
    )
    .bind(end_ms)
    .bind(start_ms)
    .bind(i64::from(closed_only))
    .fetch_all(&mut **tx)
    .await
    .map_err(|error| format!("failed to read anonymous facts: {error}"))?
    {
        candidates.push(OwnedActivityRange {
            origin: ActivityOrigin::Native,
            start_ms: row.get("start_time"),
            end_ms: row.get("end_time"),
            capacity_end_ms: None,
            value: CandidateValue {
                anonymous: true,
                device_id: device_id.to_string(),
                app_name: String::new(),
                exe_name: String::new(),
                source_id: "native".into(),
            },
        });
    }
    Ok(candidates)
}

/// 读一遍事实表里最宽的边界（`initialize_backfill` 用）。放在这里是为了让
/// `hourly.rs` 的 SQL 都集中在同一处。
pub(super) async fn fact_bounds(tx: &mut Transaction<'_, Sqlite>) -> Result<(Option<i64>, Option<i64>), String> {
    let bounds = sqlx::query(
        "SELECT MIN(start_ms) start_ms, MAX(end_ms) end_ms
         FROM (
           SELECT start_time start_ms, end_time end_ms FROM sessions WHERE end_time IS NOT NULL
           UNION ALL
           SELECT start_time, end_time FROM anonymous_activity WHERE end_time IS NOT NULL
           UNION ALL
           SELECT start_time, end_time FROM import_exact_sessions
           UNION ALL
           SELECT bucket_start_time, bucket_start_time + 3600000 FROM import_time_buckets
         )",
    )
    .fetch_one(&mut **tx)
    .await
    .map_err(|error| format!("failed to inspect hourly backfill bounds: {error}"))?;
    Ok((bounds.get("start_ms"), bounds.get("end_ms")))
}

/// 投影重建时给「活跃会话」用的最小开始时刻探针。
///
/// 迁移 28 之后**每台设备**都可以各有一条进行中的会话，所以是 `MIN(start_time)`
/// 而不是「唯一那条」。索引钉在 `idx_sessions_end_start`：`end_time IS NULL` 让它
/// 只扫进行中的那几行，不会退化成扫全部历史会话。
pub(super) const ACTIVE_SESSION_START_SQL: &str =
    "SELECT MIN(start_time) FROM sessions INDEXED BY idx_sessions_end_start WHERE end_time IS NULL";

/// 读活跃会话的最小开始时刻（`None` = 没有进行中的会话）。
pub(super) async fn active_session_start(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Option<i64>, String> {
    sqlx::query_scalar::<_, Option<i64>>(ACTIVE_SESSION_START_SQL)
        .fetch_one(&mut **tx)
        .await
        .map_err(|error| format!("failed to inspect active session overlay: {error}"))
}

/// 读匿名活动的活跃开始时刻（`None` = 没有）。
pub(super) async fn active_anonymous_start(
    tx: &mut Transaction<'_, Sqlite>,
) -> Result<Option<i64>, String> {
    sqlx::query_scalar::<_, i64>(
        "SELECT start_time FROM anonymous_activity INDEXED BY idx_anonymous_activity_active WHERE end_time IS NULL LIMIT 1",
    )
    .fetch_optional(&mut **tx)
    .await
    .map_err(|error| format!("failed to inspect anonymous overlay: {error}"))
}

/// 事实支路的**真实位置区间**：`(device_id, start_ms, end_ms)`，已按优先级裁过。
///
/// 日级（`daily.rs`）与逐桶并集（`bucket_unions`）都从这里取几何。共用一处不是为了
/// 省几行——两处各写一份的话，`anonymous_activity` 或导入桶的归属规则改了一处漏了另一处，
/// 结果就是「历史页总数」与「热力图格子」对不上，而两边都不会报错。
pub(super) async fn resolve_activity_spans(
    tx: &mut Transaction<'_, Sqlite>,
    start_ms: i64,
    end_ms: i64,
    current_ms: i64,
) -> Result<Vec<(String, i64, i64)>, String> {
    let fallback_device_id = local_device_id(tx).await?;
    let candidates =
        load_fact_candidates(tx, start_ms, end_ms, false, current_ms, &fallback_device_id).await?;
    let mut spans = Vec::new();
    for range in resolve_activity_precedence(&candidates) {
        let clipped_start = range.start_ms.max(start_ms);
        let clipped_end = range.end_ms.min(end_ms);
        if clipped_end > clipped_start {
            spans.push((range.value.device_id.clone(), clipped_start, clipped_end));
        }
    }
    Ok(spans)
}

/// 逐桶并集：单设备走「加总」（与改造前逐格相等），多设备才回事实表求并集。
///
/// **为什么多设备必须回事实表**：`records` 的起点全被压到桶起点（这是聚合命令的
/// 契约，趋势卡正是靠它只要时长），位置没了就分不清「两台机器各干 30 分钟」与
/// 「两台机器叠着干了 30 分钟」。而单设备不需要位置——一台机器同一瞬间只有一个前台
/// 应用，加总就是真值，这也让单设备读数与改造前**位等**，不靠"看起来差不多"。
pub(super) async fn bucket_unions(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
    boundaries: &[i64],
    records: &[ActivityAggregateRecordDto],
) -> Result<Vec<i64>, String> {
    if boundaries.len() < 2 {
        return Ok(Vec::new());
    }
    if buckets::distinct_device_count(records) <= 1 {
        return Ok(buckets::sum_overlaps_per_bucket(records, boundaries));
    }
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to begin activity bucket union read: {error}"))?;
    let spans = resolve_activity_spans(&mut tx, start_ms, end_ms, super::now_ms()).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to finish activity bucket union read: {error}"))?;
    Ok(buckets::union_spans_per_bucket(&spans, boundaries))
}
