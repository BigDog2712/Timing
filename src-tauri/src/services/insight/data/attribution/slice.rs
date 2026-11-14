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

#[cfg(test)]
#[path = "slice_tests.rs"]
mod slice_tests;
