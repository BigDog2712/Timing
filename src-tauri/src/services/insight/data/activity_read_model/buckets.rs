//! 桶裁剪：把「按事实排好的区间」重新切成调用方要的桶边界。
//!
//! 从 `activity_read_model/mod.rs` 搬出来（那里正好压在冻结线上）。**纯函数**，
//! 不碰库、不碰时钟，所以单测可以直接钉。
//!
//! ## 它做的是"再分配"而不是"过滤"
//!
//! 一条记录跨多个桶时，时长按桶切开分别累加（`clipped = [max(start,b0), min(end,b1)]`）；
//! 同一个桶里同 `exe_name` 的多条合并成一条。**总时长守恒**：跨桶前后求和相等，
//! 由 `mod_mod_tests.rs` 的 `page_shaped_boundaries_reduce_records_without_changing_duration`
//! 与 `page_shaped_boundaries_preserve_overlapping_duration_without_crossing_the_bucket` 钉住。
//!
//! ## 为什么一条桶内时长要再拆多行
//!
//! 合并后的时长可能大于桶宽（同一 app 在同一桶里有多条重叠记录）。前端按
//! `end - start` 画条，所以这里拆成若干条首尾相接的区间，每段不超过桶宽，
//! 保证"画出来的总长 = 算出来的总长"。
//!
//! ## 桶级并集（P2 · T07）
//!
//! `sum_overlaps_per_bucket` / `union_spans_per_bucket` 是热力与趋势卡的读数来源。
//! **两份实现只有一个差异**：跨设备要不要去重。
//!   · 单设备：`sum`（一台机器不可能同时跑两个前台应用，投影丢了位置所以加总才是真值，
//!     也正因如此单设备读数与改造前**逐格相等**）；
//!   · 多设备：`union`（两台机器同一时段各 30 分钟，答案是 30 不是 60），必须用**真实位置**，
//!     由 `facts::bucket_unions` 决定走哪条。

use super::ActivityAggregateRecordDto;
use std::collections::{BTreeMap, BTreeSet};

/// 桶边界必须严格递增、首尾与请求区间对齐。
///
/// 上限 5000：这是前端热力图/趋势能画的最大格数，多了说明调用方算错了边界，
/// 与其让 SQLite 跑一个巨大的 IN 列表，不如直接报错。
pub(super) fn validate_aggregate_boundaries(
    start_ms: i64,
    end_ms: i64,
    boundaries: &[i64],
) -> Result<(), String> {
    if boundaries.len() < 2
        || boundaries.len() > 5_000
        || boundaries.first().copied() != Some(start_ms)
        || boundaries.last().copied() != Some(end_ms)
        || boundaries.windows(2).any(|pair| pair[1] <= pair[0])
    {
        return Err("activity aggregate bucket boundaries are invalid".to_string());
    }
    Ok(())
}

/// 按 `boundaries` 把记录重新分桶。
///
/// 返回顺序 = 桶序号升序（`BTreeMap` 的 key 第一项就是 `index`），同一桶内按
/// `(anonymous, exe_name)` 升序；每个桶内若合并时长超过桶宽，拆成多条首尾相接。
pub(super) fn aggregate_records_into_boundaries(
    records: Vec<ActivityAggregateRecordDto>,
    start_ms: i64,
    end_ms: i64,
    boundaries: &[i64],
) -> Result<Vec<ActivityAggregateRecordDto>, String> {
    validate_aggregate_boundaries(start_ms, end_ms, boundaries)?;
    let mut aggregated: BTreeMap<(usize, String, bool, String), (String, i64)> = BTreeMap::new();
    for record in records {
        let first_bucket = boundaries
            .partition_point(|boundary| *boundary <= record.start_time)
            .saturating_sub(1);
        for (index, pair) in boundaries.windows(2).enumerate().skip(first_bucket) {
            if pair[0] >= record.end_time {
                break;
            }
            let clipped_start = record.start_time.max(pair[0]);
            let clipped_end = record.end_time.min(pair[1]);
            let duration_ms = clipped_end - clipped_start;
            if duration_ms <= 0 {
                continue;
            }
            /* 设备进 key：两台机器同桶同应用是**两条**记录，不是一个"合并后的应用"。
               单设备时这一项恒定，所以记录条数与改造前完全相同。 */
            let key = (index, record.device_id.clone(), record.anonymous, record.exe_name.clone());
            let entry = aggregated
                .entry(key)
                .or_insert((record.app_name.clone(), 0));
            if !record.app_name.trim().is_empty() {
                entry.0 = record.app_name.clone();
            }
            entry.1 += duration_ms;
        }
    }
    let mut result = Vec::new();
    for ((index, device_id, anonymous, exe_name), (app_name, duration_ms)) in aggregated {
        let bucket_duration_ms = boundaries[index + 1] - boundaries[index];
        let mut remaining_ms = duration_ms;
        while remaining_ms > 0 {
            let chunk_ms = remaining_ms.min(bucket_duration_ms);
            result.push(ActivityAggregateRecordDto {
                anonymous,
                app_name: app_name.clone(),
                exe_name: exe_name.clone(),
                device_id: device_id.clone(),
                start_time: boundaries[index],
                end_time: boundaries[index] + chunk_ms,
            });
            remaining_ms -= chunk_ms;
        }
    }
    Ok(result)
}

/// 排序 + **前缀最大终点**求并集总长。
///
/// `covered_from` 用的是历史最大终点，不是上一条的 `end`：上一条可能整个被更早的一条
/// 包住，那样「取上一条的 end」会让后面一段重复计入（`daily_tests` 里那条
/// `fully_nested_intervals_do_not_shrink_the_union` 就是专门咬这一口的）。
///
/// 这一份实现同时被 `daily.rs`（日级并集）与下面的逐桶并集使用——**不要**再抄第二份。
pub(super) fn union_span_ms(spans: &mut Vec<(i64, i64)>) -> i64 {
    spans.retain(|(start_ms, end_ms)| end_ms > start_ms);
    spans.sort_unstable();
    let mut total_ms = 0;
    let mut max_end_ms = i64::MIN;
    for (start_ms, end_ms) in spans.iter().copied() {
        let covered_from_ms = start_ms.max(max_end_ms);
        if end_ms > covered_from_ms {
            total_ms += end_ms - covered_from_ms;
        }
        max_end_ms = max_end_ms.max(end_ms);
    }
    total_ms
}

/// `records` 里出现过几台设备（单设备判断用；`records` 为空时是 0）。
pub(super) fn distinct_device_count(records: &[ActivityAggregateRecordDto]) -> usize {
    let devices: BTreeSet<&str> = records
        .iter()
        .map(|record| record.device_id.as_str())
        .collect();
    devices.len()
}

/// 逐桶「每条记录与桶求交集再相加」——**单设备口径**，与改造前的逐格数值逐格相同。
pub(super) fn sum_overlaps_per_bucket(
    records: &[ActivityAggregateRecordDto],
    boundaries: &[i64],
) -> Vec<i64> {
    let mut totals = vec![0_i64; boundaries.len().saturating_sub(1)];
    for record in records {
        let first_bucket = boundaries
            .partition_point(|boundary| *boundary <= record.start_time)
            .saturating_sub(1);
        for (index, pair) in boundaries.windows(2).enumerate().skip(first_bucket) {
            if pair[0] >= record.end_time {
                break;
            }
            let overlap_ms =
                record.end_time.min(pair[1]) - record.start_time.max(pair[0]);
            if overlap_ms > 0 {
                totals[index] += overlap_ms;
            }
        }
    }
    totals
}

/// 逐桶跨设备并集。`spans` 是 `(device_id, start_ms, end_ms)` 的**真实位置**。
///
/// 顺序是「先设备内求并、再跨设备求并」，不是「直接对全体求并」：
/// 同一设备的两段如果互相包含，先各自求并能保留"这台机器确实记了这么多"，
/// 第二条并则只去掉两台机器之间的重复。
pub(super) fn union_spans_per_bucket(
    spans: &[(String, i64, i64)],
    boundaries: &[i64],
) -> Vec<i64> {
    let bucket_count = boundaries.len().saturating_sub(1);
    let mut per_bucket: Vec<BTreeMap<&str, Vec<(i64, i64)>>> =
        (0..bucket_count).map(|_| BTreeMap::new()).collect();
    for (device_id, start_ms, end_ms) in spans {
        if *end_ms <= *start_ms {
            continue;
        }
        let first_bucket = boundaries
            .partition_point(|boundary| *boundary <= *start_ms)
            .saturating_sub(1);
        for index in first_bucket..bucket_count {
            if boundaries[index] >= *end_ms {
                break;
            }
            let clipped_start = (*start_ms).max(boundaries[index]);
            let clipped_end = (*end_ms).min(boundaries[index + 1]);
            if clipped_end > clipped_start {
                per_bucket[index]
                    .entry(device_id.as_str())
                    .or_default()
                    .push((clipped_start, clipped_end));
            }
        }
    }
    per_bucket
        .into_iter()
        .map(|by_device| {
            let mut merged: Vec<(i64, i64)> = Vec::new();
            for (_, mut device_spans) in by_device {
                union_span_ms(&mut device_spans);
                device_spans.retain(|(start_ms, end_ms)| end_ms > start_ms);
                merged.extend(device_spans);
            }
            union_span_ms(&mut merged)
        })
        .collect()
}
