//! 块与子记录的读侧：按区间取块、把块切成子记录。
//!
//! 从 `focus_blocks.rs` 拆出（单文件 ≤300 行纪律）：写入侧（投影）与读取侧的
//! 判据完全不同 —— 投影的问句是「能不能重造」，读侧的问句是「块 ∩ 事实怎么切」。
//!
//! 切片本身是纯函数（`attribution::slice::slice_block`），这里只负责把三份输入
//! （块 / 事实 / 分类绑定 / 手工改判）从库里取出来。

use sqlx::{Pool, Row, Sqlite};
use std::collections::BTreeMap;

use crate::services::insight::data::attribution::slice::{
    slice_block, summarize_by_category, BlockSpan, ChildSegment, FactSpan, SegmentOverride,
};
use crate::services::insight::data::attribution::AppCategory;
use super::{to_block_dto, FocusBlockDto};

/// 一个块的详情：块本身 + 切出来的子记录 + 按分类汇总。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockDetailDto {
    pub block: FocusBlockDto,
    pub segments: Vec<ChildSegmentDto>,
    /// 分类 → 毫秒。顺序按分类键（BTreeMap），三次刷新不会换位置。
    pub totals_by_category: BTreeMap<String, i64>,
}

/// 一条子记录（命令出参）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChildSegmentDto {
    pub app_key: String,
    pub app_name: String,
    /// 产生这段活动的设备（双端并行时同应用会有两段，靠它区分）。
    pub device_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub category_key: String,
}

impl From<ChildSegment> for ChildSegmentDto {
    fn from(segment: ChildSegment) -> Self {
        Self {
            app_key: segment.app_key,
            app_name: segment.app_name,
            device_id: segment.device_id,
            start_ms: segment.start_ms,
            end_ms: segment.end_ms,
            category_key: segment.category_key,
        }
    }
}

/// 按区间读块（时间轴 / 历史页）。
pub async fn list_blocks(
    activity: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<FocusBlockDto>, String> {
    let rows = sqlx::query(
        "SELECT uid, device_id, item_uid, item_name, category_key, start_time, end_time
           FROM focus_blocks
          WHERE start_time < ?2 AND COALESCE(end_time, ?2) > ?1
          ORDER BY start_time ASC, uid ASC",
    )
    .bind(start_ms)
    .bind(end_ms)
    .fetch_all(activity)
    .await
    .map_err(|error| format!("failed to read focus blocks: {error}"))?;
    Ok(rows.iter().map(to_block_dto).collect())
}

/// 一个块的完整详情（块 + 子记录 + 分类汇总）。
pub async fn block_detail(
    activity: &Pool<Sqlite>,
    block_uid: &str,
    now_ms: i64,
) -> Result<BlockDetailDto, String> {
    let block = load_block(activity, block_uid).await?;
    let facts = load_facts(activity, block.start_time, block.end_time.unwrap_or(now_ms)).await?;
    let categories = load_categories(activity, &facts).await?;
    let overrides = load_overrides(activity, block_uid).await?;
    let segments = slice_block(
        &BlockSpan {
            start_ms: block.start_time,
            end_ms: block.end_time.unwrap_or(now_ms),
            category_key: block.category_key.clone(),
        },
        &facts,
        &categories,
        &overrides,
    );
    let totals = summarize_by_category(&segments);
    Ok(BlockDetailDto {
        block,
        segments: segments.into_iter().map(ChildSegmentDto::from).collect(),
        totals_by_category: totals,
    })
}

async fn load_block(activity: &Pool<Sqlite>, block_uid: &str) -> Result<FocusBlockDto, String> {
    let row = sqlx::query(
        "SELECT uid, device_id, item_uid, item_name, category_key, start_time, end_time
           FROM focus_blocks WHERE uid = ?1",
    )
    .bind(block_uid)
    .fetch_optional(activity)
    .await
    .map_err(|error| format!("failed to read focus block `{block_uid}`: {error}"))?;
    match row {
        Some(row) => Ok(to_block_dto(&row)),
        None => Err(format!(
            "focus block `{block_uid}` does not exist; run the projection first"
        )),
    }
}

/// 与区间相交的应用事实。进行中的事实按 `now` 收尾（调用方把 now 传成区间上界）。
pub(super) async fn load_facts(
    activity: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<FactSpan>, String> {
    let rows = sqlx::query(
        "SELECT app_key, app_name, device_id, start_time, COALESCE(end_time, ?2) AS effective_end
           FROM sessions
          WHERE start_time < ?2 AND COALESCE(end_time, ?2) > ?1
          ORDER BY start_time ASC, app_key ASC",
    )
    .bind(start_ms)
    .bind(end_ms)
    .fetch_all(activity)
    .await
    .map_err(|error| format!("failed to read activity facts: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| FactSpan {
            app_key: row.get("app_key"),
            app_name: row.get::<Option<String>, _>("app_name").unwrap_or_default(),
            device_id: row.get("device_id"),
            start_ms: row.get("start_time"),
            end_ms: row.get("effective_end"),
        })
        .collect())
}

/// 事实里出现过的应用各自的分类集（按 priority 升序，首个即「分类首位」）。
pub(super) async fn load_categories(
    activity: &Pool<Sqlite>,
    facts: &[FactSpan],
) -> Result<BTreeMap<String, Vec<AppCategory>>, String> {
    let keys: Vec<&str> = {
        let mut keys: Vec<&str> = facts.iter().map(|fact| fact.app_key.as_str()).collect();
        keys.sort_unstable();
        keys.dedup();
        keys
    };
    let mut map: BTreeMap<String, Vec<AppCategory>> = BTreeMap::new();
    if keys.is_empty() {
        return Ok(map);
    }
    /* 逐个应用查而不是拼 `IN (…)`：绑定表很小（一个应用几条），而拼 SQL 要处理
       参数个数上限与注入面；逐查的代价在这个规模上量不出来。 */
    for key in keys {
        let rows = sqlx::query(
            "SELECT category_key, priority FROM app_category
              WHERE app_key = ?1 ORDER BY priority ASC, category_key ASC",
        )
        .bind(key)
        .fetch_all(activity)
        .await
        .map_err(|error| format!("failed to read app categories for `{key}`: {error}"))?;
        if rows.is_empty() {
            continue;
        }
        map.insert(
            key.to_string(),
            rows.iter()
                .map(|row| AppCategory {
                    category_key: row.get("category_key"),
                    priority: row.get("priority"),
                })
                .collect(),
        );
    }
    Ok(map)
}

pub(super) async fn load_overrides(
    activity: &Pool<Sqlite>,
    block_uid: &str,
) -> Result<Vec<SegmentOverride>, String> {
    let rows = sqlx::query(
        "SELECT app_key, seg_start, category_key, excluded
           FROM block_segment_override WHERE block_uid = ?1 ORDER BY seg_start ASC",
    )
    .bind(block_uid)
    .fetch_all(activity)
    .await
    .map_err(|error| format!("failed to read block overrides: {error}"))?;
    Ok(rows
        .iter()
        .map(|row| SegmentOverride {
            app_key: row.get("app_key"),
            seg_start_ms: row.get("seg_start"),
            category_key: row.get("category_key"),
            excluded: row.get::<i64, _>("excluded") != 0,
        })
        .collect())
}
