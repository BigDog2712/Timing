//! 子记录切片：事项块 ∩ 应用事实 → 按应用分段，并解析每段的分类。
//!
//! ## 为什么子记录不落表
//!
//! 「子记录 = 块 ∩ 事实」是**派生**关系，不是新事实。落表会在四处立刻坏：
//!
//! 1. 块可编辑（拖动改时间）→ 改一次要重写该块下全部子记录，双写必然出现半截状态；
//! 2. 事实跨边界（chrome 09:00–10:00，块是 09:30–11:30）→ 只能切片，落表就得把
//!    一条事实拆成两行，而事实本身仍是一条，两边开始各说各话；
//! 3. 块内可能没采集到事实（隐私排除 / 追踪未启动）→ 派生给「空档」，落表只能造假 0；
//! 4. 双端并行计时产生两条重叠块 → 落表就出现双份，`SUM(duration)` 直接翻倍。
//!
//! ## 三条边界规则
//!
//! - **相交才保留**：`[max(块起, 事实起), min(块止, 事实止))` 为空则丢弃；
//! - **不合并**：两个相邻的 chrome 段保持两段。合并会抹掉「中间其实切走过」这件事，
//!   而用户手工改判是按段落的；
//! - **override 先于规则**：用户改判过的那一段不再走 `resolve_child_category`，
//!   否则「改了但没生效」会变成最难解释的那类反馈。

use std::collections::BTreeMap;

use super::{resolve_child_category, AppCategory};

/// 一段应用事实（活动库 `sessions` 的一行）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FactSpan {
    pub app_key: String,
    pub app_name: String,
    /// 这条事实由哪台设备产生。双端可同时对同一事项计时，同一应用会有两段不同设备的事实
    /// —— 不带这一维，界面上就是「chrome 被记了两遍」，而不是「PC 与手机各一段」。
    pub device_id: String,
    pub start_ms: i64,
    /// 进行中的事实由调用方填「此刻」；切片不认识时钟。
    pub end_ms: i64,
}

/// 一个事项块的时间范围与它的事项分类（`focus_blocks` 的一行）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BlockSpan {
    pub start_ms: i64,
    pub end_ms: i64,
    pub category_key: Option<String>,
}

/// 用户对某一段的手工改判（`block_segment_override` 的一行）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SegmentOverride {
    pub app_key: String,
    /// 与**切片后**的起点比对，不是原始事实起点：用户点的是界面上那一段。
    pub seg_start_ms: i64,
    pub category_key: Option<String>,
    pub excluded: bool,
}

/// 一条子记录（界面上的「应用:chrome-分类:学习-9:30-11:00」）。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildSegment {
    pub app_key: String,
    pub app_name: String,
    /// 承接自 `FactSpan`：切片不改写设备归属。
    pub device_id: String,
    pub start_ms: i64,
    pub end_ms: i64,
    pub category_key: String,
}

impl ChildSegment {
    pub fn duration_ms(&self) -> i64 {
        (self.end_ms - self.start_ms).max(0)
    }
}

/// 切片。`categories` 是「应用 → 它的分类集（已按 priority 升序）」。
///
/// 输出顺序 `(start_ms, app_key)`：界面上就是时间轴顺序，且同一个起点上多段时
/// 顺序是确定的（否则每次渲染可能换位置）。
pub fn slice_block(
    block: &BlockSpan,
    facts: &[FactSpan],
    categories: &BTreeMap<String, Vec<AppCategory>>,
    overrides: &[SegmentOverride],
) -> Vec<ChildSegment> {
    let mut segments: Vec<ChildSegment> = Vec::new();
    for fact in facts {
        let start_ms = fact.start_ms.max(block.start_ms);
        let end_ms = fact.end_ms.min(block.end_ms);
        if end_ms <= start_ms {
            // 不相交或零长：零长段会以「0 分钟的 chrome」出现在界面上，没有任何意义。
            continue;
        }
        let override_row = overrides
            .iter()
            .find(|row| row.app_key == fact.app_key && row.seg_start_ms == start_ms);
        if let Some(row) = override_row {
            if row.excluded {
                continue;
            }
            if let Some(category) = row
                .category_key
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                segments.push(ChildSegment {
                    app_key: fact.app_key.clone(),
                    app_name: fact.app_name.clone(),
                    device_id: fact.device_id.clone(),
                    start_ms,
                    end_ms,
                    category_key: category.to_string(),
                });
                continue;
            }
        }
        let resolved = resolve_child_category(
            categories.get(&fact.app_key).map(Vec::as_slice).unwrap_or(&[]),
            block.category_key.as_deref(),
        );
        segments.push(ChildSegment {
            app_key: fact.app_key.clone(),
            app_name: fact.app_name.clone(),
            device_id: fact.device_id.clone(),
            start_ms,
            end_ms,
            category_key: resolved,
        });
    }
    segments.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.app_key.cmp(&right.app_key))
    });
    segments
}

/// 把切片结果折成「分类 → 时长」汇总（时间轴图例与饼图都用它）。
///
/// 同一应用在不同块里可能落到不同分类，所以汇总的键是**分类**而不是应用。
pub fn summarize_by_category(segments: &[ChildSegment]) -> BTreeMap<String, i64> {
    let mut totals: BTreeMap<String, i64> = BTreeMap::new();
    for segment in segments {
        *totals.entry(segment.category_key.clone()).or_insert(0) += segment.duration_ms();
    }
    totals
}

/// 区间**并集**（running max），输出按起点升序、互不重叠。
///
/// ## 为什么不能求和
///
/// 双端并行计时会给出两条重叠块（PC 09:30–11:30、手机 10:00–10:40），
/// `sum` 会把这天算成 2 小时 40 分。并集之后才是「这件事实际占用了多久」。
/// 同型问题在 P2 的热力/趋势上已经出现过一次（服务侧逐桶并集），这里不重复犯错。
///
/// ## 为什么不用 `LAG`
///
/// 完全嵌套（`10:00–10:40` 整个落在 `09:30–11:30` 里）时，「与前一条比较」的写法
/// 会把并集判成两条独立段，少算且**零报错**。running max 对嵌套、包含、相邻全对。
///
/// 零长与倒挂（`end <= start`）的区间在入口就被丢掉：它们只可能来自坏数据，
/// 留在结果里会让「并集」比原始数据还长。
pub fn union_ranges(ranges: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut valid: Vec<(i64, i64)> = ranges
        .iter()
        .copied()
        .filter(|(start, end)| end > start)
        .collect();
    valid.sort_unstable();
    let mut merged: Vec<(i64, i64)> = Vec::with_capacity(valid.len());
    for (start, end) in valid {
        match merged.last_mut() {
            /* `start <= last.1` 相邻也算接上：两段 09:30–10:00 与 10:00–10:30 之间
               没有任何缝，分成两段会让界面上多出一条 0 宽的空档。 */
            Some(last) if start <= last.1 => last.1 = last.1.max(end),
            _ => merged.push((start, end)),
        }
    }
    merged
}

/// `outer` 内**没有被** `covered` 覆盖的部分（两者都必须是已并集的区间）。
///
/// 时间轴上层画块、下层画子记录，中间剩下的就是「块内在跑，但没采集到应用」——
/// 用户例子里的 11:00–11:30（块到 11:30，chrome 只到 11:00）。这部分必须**显式**
/// 产出：显示 0 会让人以为计时坏了，不显示则看起来块与子记录对不上。
pub fn gaps_within(outer: &[(i64, i64)], covered: &[(i64, i64)]) -> Vec<(i64, i64)> {
    let mut gaps: Vec<(i64, i64)> = Vec::new();
    for &(outer_start, outer_end) in outer {
        let mut cursor = outer_start;
        for &(cover_start, cover_end) in covered {
            if cover_end <= cursor {
                continue;
            }
            if cover_start >= outer_end {
                break;
            }
            if cover_start > cursor {
                gaps.push((cursor, cover_start.min(outer_end)));
            }
            cursor = cursor.max(cover_end);
            if cursor >= outer_end {
                break;
            }
        }
        if cursor < outer_end {
            gaps.push((cursor, outer_end));
        }
    }
    gaps
}

#[cfg(test)]
#[path = "slice_tests.rs"]
mod slice_tests;

/* 设备维度单独一个文件：`slice_tests.rs` 已到 300 行硬限，而这一组的判据与切片本身的
   正确性无关（丢设备不会让任何数字变错，只让双端并行不可见）。 */
#[cfg(test)]
#[path = "slice_device_tests.rs"]
mod slice_device_tests;
