//! `daily::compute_day` 的纯函数用例。
//!
//! 这些用例存在的理由只有一个：并集算法一旦退化成「取上一条的 end」（`LAG` 语义），
//! **没有任何其他测试会红**——投影读数是按小时加总的，日级表是新增的，前端 P1 还没接。
//! 所以把几何形状直接钉在这里，用分钟数说话。

use super::daily::compute_day;

const MINUTE_MS: i64 = 60 * 1000;
const HOUR_MS: i64 = 60 * MINUTE_MS;

/// 一台设备记了整段、另一台的记录**完全落在里面**，然后又跨出它的右边界。
///
/// 这是变异自证的靶子。几何（分钟）：
/// ```text
/// device-a  |------------ 9:00-10:00 (60) ------------|
/// device-b      9:30-9:50 (20)        9:55-10:10 (15)
/// ```
/// 正确并集 = 60 + 10（9:55–10:10 里落在 10:00 之后的那 10 分钟）= 70 分钟；
/// 设备之和 = 60 + 35 = 95 分钟。
///
/// **为什么不能只写「两段完全相同」**：完全相同（同起点同终点）时，按 end 排序后
/// 两段相邻，`LAG` 与「前缀最大终点」给出同一个数——那条用例对变异是免疫的。
/// 必须让被嵌套的那一段**后面还有一段**（`LAG` 会用 9:50 而不是 10:00 作为已覆盖边界）。
#[test]
fn fully_nested_intervals_do_not_shrink_the_union() {
    let nine = 9 * HOUR_MS;
    let totals = compute_day(&[
        ("device-a", nine, nine + HOUR_MS),
        ("device-b", nine + 30 * MINUTE_MS, nine + 50 * MINUTE_MS),
        ("device-b", nine + 55 * MINUTE_MS, nine + HOUR_MS + 10 * MINUTE_MS),
    ]);
    assert_eq!(totals.union_ms, 70 * MINUTE_MS);
    assert_eq!(totals.device_sum_ms, 95 * MINUTE_MS);
    assert_eq!(
        totals.devices,
        vec![
            ("device-a".to_string(), 60 * MINUTE_MS),
            ("device-b".to_string(), 35 * MINUTE_MS),
        ]
    );
}

/// 一台设备 12 小时、另一台与它完全重合：并集仍是 12 小时（≤24h 才敢画进度条），
/// 而设备之和是 24 小时（**只许**出现在历史页）。
#[test]
fn device_sum_can_exceed_the_union_when_two_devices_overlap_all_day() {
    let totals = compute_day(&[("device-a", 0, 12 * HOUR_MS), ("device-b", 0, 12 * HOUR_MS)]);
    assert_eq!(totals.union_ms, 12 * HOUR_MS);
    assert_eq!(totals.device_sum_ms, 24 * HOUR_MS);
    assert_eq!(totals.devices.len(), 2);
}

/// 零长度会话不参与并集，也不参与分设备合计。
///
/// 真实库里有 867 行 `end_time = start_time`（切窗口太快时落下的），把它们算进去
/// 不会改变数字，但会让「设备有活动」的判断出现假阳性。
#[test]
fn zero_length_and_inverted_intervals_contribute_nothing() {
    let totals = compute_day(&[
        ("device-a", 5 * MINUTE_MS, 5 * MINUTE_MS),
        ("device-a", 10 * MINUTE_MS, 3 * MINUTE_MS),
        ("device-a", 0, 5 * MINUTE_MS),
    ]);
    assert_eq!(totals.union_ms, 5 * MINUTE_MS);
    assert_eq!(totals.device_sum_ms, 5 * MINUTE_MS);
    assert_eq!(totals.devices, vec![("device-a".to_string(), 5 * MINUTE_MS)]);
}

/// 同一台设备的重叠区间是**并集**，不是加总：这不影响 `device_sum_ms` 的定义，
/// 但决定了它和小时投影的加总在「重叠多开」时是否一致——P1 的现网数据零重叠，
/// 所以两者逐位相等；一旦出现重叠，日级口径按墙钟算（这才是"用了多久"）。
#[test]
fn overlapping_intervals_on_one_device_are_merged() {
    let totals = compute_day(&[
        ("device-a", 0, 30 * MINUTE_MS),
        ("device-a", 20 * MINUTE_MS, 50 * MINUTE_MS),
    ]);
    assert_eq!(totals.union_ms, 50 * MINUTE_MS);
    assert_eq!(totals.device_sum_ms, 50 * MINUTE_MS);
}

/// 相邻不算重叠：00:00–00:30 与 00:30–01:00 加起来正好一小时，不能被合并成 30 分钟。
#[test]
fn adjacent_intervals_are_added_not_dropped() {
    let totals = compute_day(&[
        ("device-a", 0, 30 * MINUTE_MS),
        ("device-a", 30 * MINUTE_MS, HOUR_MS),
    ]);
    assert_eq!(totals.union_ms, HOUR_MS);
    assert_eq!(totals.device_sum_ms, HOUR_MS);
}

/// 空输入是合法的（某天完全没活动，或者区间全被零长度过滤掉）。
#[test]
fn empty_input_yields_zeroes_and_no_devices() {
    let totals = compute_day::<&str>(&[]);
    assert_eq!(totals.union_ms, 0);
    assert_eq!(totals.device_sum_ms, 0);
    assert!(totals.devices.is_empty());
}
