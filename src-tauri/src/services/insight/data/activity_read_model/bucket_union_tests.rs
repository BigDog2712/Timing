//! 逐桶并集的纯函数用例（P2 · T07）。
//!
//! 为什么必须在 Rust 侧有这一份：`records` 到了前端的桶里已经**没有位置**，
//! 前端算不出并集；所以「两台设备重叠时是 30 分钟还是 60 分钟」这件事**只能**在
//! 这里被钉住。前端那几条用例钉的是"读数确实取了这个字段"，不是"这个字段算对了"。

use super::buckets::{
    distinct_device_count, sum_overlaps_per_bucket, union_span_ms, union_spans_per_bucket,
};
use super::ActivityAggregateRecordDto;
use crate::models::insight::activity_read_model::HOUR_MS;

const HOUR9: i64 = 9 * HOUR_MS;

fn record(device_id: &str, start_time: i64, end_time: i64) -> ActivityAggregateRecordDto {
    ActivityAggregateRecordDto {
        anonymous: false,
        app_name: "Code".into(),
        exe_name: "code.exe".into(),
        device_id: device_id.into(),
        start_time,
        end_time,
    }
}

fn spans(pairs: &[(&str, i64, i64)]) -> Vec<(String, i64, i64)> {
    pairs
        .iter()
        .map(|(device, start, end)| ((*device).to_string(), *start, *end))
        .collect()
}

/// 两台设备 9:30–10:00 **完全重合**：并集 30 分钟，设备合计 60 分钟。
///
/// 这一条就是 P2 的全部意义所在：单设备时 `union == device_sum` 恒成立，
/// 所以并集实现错了在真实数据上**永远不会**被咬住。
#[test]
fn two_devices_fully_overlapping_report_the_union_not_the_device_sum() {
    let boundaries = [HOUR9, HOUR9 + HOUR_MS];
    let merged = spans(&[
        ("aaaa1111", HOUR9 + 30 * 60_000, HOUR9 + HOUR_MS),
        ("bbbb2222", HOUR9 + 30 * 60_000, HOUR9 + HOUR_MS),
    ]);
    let union = union_spans_per_bucket(&merged, &boundaries);
    assert_eq!(union, vec![30 * 60_000], "并集必须是 30 分钟（跨设备去重）");

    let records = vec![
        record("aaaa1111", HOUR9 + 30 * 60_000, HOUR9 + HOUR_MS),
        record("bbbb2222", HOUR9 + 30 * 60_000, HOUR9 + HOUR_MS),
    ];
    let sum = sum_overlaps_per_bucket(&records, &boundaries);
    assert_eq!(sum, vec![60 * 60_000], "单设备快路径加起来必须是 60 分钟");
    assert_eq!(distinct_device_count(&records), 2, "两条记录必须被认成两台设备");
}

/// 两台设备**不重叠**时并集 = 加总（各 30 分钟首尾相接 = 60 分钟）。
///
/// 这一条防的是"跨设备一律取 max"的偷懒实现：那样 9:00–9:30 + 9:30–10:00 会算成 30。
#[test]
fn two_devices_adjacent_but_not_overlapping_keep_the_full_span() {
    let boundaries = [HOUR9, HOUR9 + HOUR_MS];
    let merged = spans(&[
        ("aaaa1111", HOUR9, HOUR9 + 30 * 60_000),
        ("bbbb2222", HOUR9 + 30 * 60_000, HOUR9 + HOUR_MS),
    ]);
    assert_eq!(union_spans_per_bucket(&merged, &boundaries), vec![HOUR_MS]);
}

/// 嵌套 + 跨界：先设备内求并、再跨设备求并（`LAG` 语义会在这里少算）。
#[test]
fn nested_and_crossing_intervals_do_not_shrink_the_union() {
    let boundaries = [0, 100];
    let merged = spans(&[
        ("aaaa1111", 0, 60),
        ("aaaa1111", 10, 20),
        ("bbbb2222", 50, 80),
    ]);
    /* 设备 a：[0,60) ∪ [10,20) = [0,60) = 60；设备 b：[50,80) = 30；
       两者再求并 = [0,80) = 80。
       「取上一条的 end」（LAG 语义）在这里会算成 60 + 0 + 30 = **90** —— 多算 10 分钟，
       而且只在"嵌套之后还有一个从中间起头的区间"这个形状上才暴露。 */
    assert_eq!(union_spans_per_bucket(&merged, &boundaries), vec![80]);
}

/// 跨桶裁剪：一段 9:50–10:20 的会话在两个小时桶里各算 10 / 20 分钟。
#[test]
fn spans_are_clipped_per_bucket() {
    let boundaries = [HOUR9, HOUR9 + HOUR_MS, HOUR9 + 2 * HOUR_MS];
    let merged = spans(&[("aaaa1111", HOUR9 + 50 * 60_000, HOUR9 + HOUR_MS + 20 * 60_000)]);
    assert_eq!(
        union_spans_per_bucket(&merged, &boundaries),
        vec![10 * 60_000, 20 * 60_000]
    );
}

/// 空区间与倒置区间贡献 0（真实库里 `duration = 0` 的会话有一堆）。
#[test]
fn empty_and_inverted_spans_contribute_nothing() {
    let boundaries = [0, 100];
    let merged = spans(&[("aaaa1111", 40, 40), ("bbbb2222", 60, 20)]);
    assert_eq!(union_spans_per_bucket(&merged, &boundaries), vec![0]);
    let mut empty: Vec<(i64, i64)> = vec![(10, 10), (20, 5)];
    assert_eq!(union_span_ms(&mut empty), 0);
}

/// 单设备快路径必须与 `union_span_ms` 在**不重叠**数据上逐格相等 —— 这是"改造前数字不变"的
/// 代数依据：老前端就是把每条记录与格子求交集再相加。
#[test]
fn single_device_sum_matches_union_when_nothing_overlaps() {
    let boundaries = [0, HOUR_MS, 2 * HOUR_MS];
    let records = vec![
        record("aaaa1111", 0, 30 * 60_000),
        record("aaaa1111", 30 * 60_000, 90 * 60_000),
    ];
    let sum = sum_overlaps_per_bucket(&records, &boundaries);
    let merged = spans(&[
        ("aaaa1111", 0, 30 * 60_000),
        ("aaaa1111", 30 * 60_000, 90 * 60_000),
    ]);
    assert_eq!(union_spans_per_bucket(&merged, &boundaries), sum);
}
