//! 双层时间轴的读模型：一个**事项**一行，行下挂它的子记录与空档。
//!
//! ## 与 `block_detail` 的分工
//!
//! `block_detail` 回答「**这一个块**里发生了什么」，用于点开某一段看细节。
//! 这里回答「**今天这些事项**各自发生了什么」，用于时间轴本身。两者共用
//! `slice_block`，区别只在聚合维度：块 → 事项。
//!
//! ## 三条必须钉住的口径
//!
//! 1. **并集不是求和**。同一事项在两端各有一条块（用户主动在另一端也点了开始），
//!    或者上午下午各记一段，`total_ms` 必须是这些区间的**并集**长度。按块求和会把
//!    双端并行的重叠部分算两遍——数字看起来「合理」，只有对账时才发现。
//! 2. **空档显式产出**。块 09:30–11:30、事实只到 11:00，那 11:00–11:30 是
//!    「未采集」不是「0 秒」。不产出这一段，上下两层就对不上，而用户只会以为
//!    「时间轴画错了」。
//! 3. **一个应用可以出现多次**。相邻的两段 chrome 不合并（中间可能切走过），
//!    合并会抹掉这个事实，而手工改判是按段落点的。

use std::collections::BTreeMap;

use sqlx::{Pool, Sqlite};

use super::read::{
    load_categories, load_facts, load_overrides, list_blocks, ChildSegmentDto,
};
use super::FocusBlockDto;
use crate::services::insight::data::attribution::slice::{
    gaps_within, slice_block, summarize_by_category, union_ranges, BlockSpan, ChildSegment,
    FactSpan,
};
use crate::services::insight::data::attribution::AppCategory;

/// 一段「未采集」的区间（块内在跑，但没有应用事实落进来）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GapDto {
    pub start_ms: i64,
    pub end_ms: i64,
}

/// 时间轴上层的一行（= 一个事项）。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ItemTimelineDto {
    pub item_uid: String,
    pub item_name: String,
    pub category_key: Option<String>,
    /// 该事项在本区间内最早的块起点。
    pub start_ms: i64,
    /// 最晚的块终点；`None` = 还有块在跑。
    pub end_ms: Option<i64>,
    /// 有块没结束（界面上标「进行中」）。
    pub running: bool,
    /// 并集时长（不是各块之和），与 `sum_of(segments) + sum_of(gaps)` 相等。
    pub total_ms: i64,
    /// 块的数量（>1 说明中途停过）。
    pub block_count: usize,
    pub segments: Vec<ChildSegmentDto>,
    pub gaps: Vec<GapDto>,
    pub totals_by_category: BTreeMap<String, i64>,
    /// 本机 `device_id`。前端拿它判断「哪一段是本机」，并且**设备数 ≤ 1 时不许渲染
    /// 任何设备元素**（`deviceLanes` 的既有口径）。
    ///
    /// 不给这个值的话前端只能猜 —— 而「手机导入的数据全折成本机 id」这件事让
    /// 「出现过」与「是本机」是两个不同的判定。
    pub self_device_id: Option<String>,
}

/// 按区间取双层时间轴。
///
/// `now_ms` 由调用方传：进行中的块/事实要收到「此刻」，而 service 层不读时钟
/// （同 `block_detail` 的做法，测试才能钉住数字）。
pub async fn item_timeline(
    activity: &Pool<Sqlite>,
    from_ms: i64,
    to_ms: i64,
    now_ms: i64,
) -> Result<Vec<ItemTimelineDto>, String> {
    let blocks = list_blocks(activity, from_ms, to_ms).await?;
    if blocks.is_empty() {
        return Ok(Vec::new());
    }

    /* 事实与分类**按整个区间取一次**：逐个块取会让「一个块一个事实区间」变成 N 次
       全表扫。分类更贵（每个应用一条 SQL），所以先去重再查。 */
    let facts = load_facts(activity, from_ms, to_ms).await?;
    let categories = load_categories(activity, &facts).await?;

    /* 按 `item_uid` 分组，保持「块按起点升序」的输入顺序（`BTreeMap` 会按 uid 重排，
       所以另存一份首次出现的次序）。 */
    let mut order: Vec<String> = Vec::new();
    let mut grouped: BTreeMap<String, Vec<FocusBlockDto>> = BTreeMap::new();
    for block in blocks {
        if !grouped.contains_key(&block.item_uid) {
            order.push(block.item_uid.clone());
        }
        grouped.entry(block.item_uid.clone()).or_default().push(block);
    }

    let mut timeline: Vec<ItemTimelineDto> = Vec::with_capacity(order.len());
    for item_uid in order {
        let item_blocks = grouped.remove(&item_uid).unwrap_or_default();
        timeline.push(build_item_row(activity, &item_blocks, &facts, &categories, from_ms, to_ms, now_ms).await?);
    }
    /* 上层按「最早起点」升序：分组是按 `BTreeMap` 的键取的，而键是 uid 不是时间。 */
    timeline.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.item_uid.cmp(&right.item_uid))
    });
    Ok(timeline)
}

/// 把一个事项的全部块折成上层一行。
async fn build_item_row(
    activity: &Pool<Sqlite>,
    blocks: &[FocusBlockDto],
    facts: &[FactSpan],
    categories: &BTreeMap<String, Vec<AppCategory>>,
    from_ms: i64,
    to_ms: i64,
    now_ms: i64,
) -> Result<ItemTimelineDto, String> {
    let first = blocks.first().ok_or("item row without blocks")?;
    let mut spans: Vec<(i64, i64)> = Vec::with_capacity(blocks.len());
    let mut segments: Vec<ChildSegment> = Vec::new();
    let mut running = false;
    let mut last_end: i64 = i64::MIN;

    for block in blocks {
        /* 进行中的块收到「此刻」，且整体夹进请求区间：时间轴请求的是 [from, to]，
           把界外的部分画进来会让上层时长与下层对不上。 */
        let raw_end = block.end_time.unwrap_or(now_ms);
        let start = block.start_time.max(from_ms);
        let end = raw_end.min(to_ms).max(start);
        match block.end_time {
            None => running = true,
            Some(_) => last_end = last_end.max(end),
        }
        spans.push((start, end));

        let overrides = load_overrides(activity, &block.uid).await?;
        segments.extend(slice_block(
            &BlockSpan {
                start_ms: start,
                end_ms: end,
                category_key: block.category_key.clone(),
            },
            facts,
            categories,
            &overrides,
        ));
    }
    segments.sort_by(|left, right| {
        left.start_ms
            .cmp(&right.start_ms)
            .then_with(|| left.app_key.cmp(&right.app_key))
    });

    let union = union_ranges(&spans);
    let total_ms: i64 = union.iter().map(|(start, end)| end - start).sum();
    let covered = union_ranges(
        &segments
            .iter()
            .map(|segment| (segment.start_ms, segment.end_ms))
            .collect::<Vec<_>>(),
    );
    let gaps: Vec<GapDto> = gaps_within(&union, &covered)
        .into_iter()
        .map(|(start_ms, end_ms)| GapDto { start_ms, end_ms })
        .collect();
    let totals = summarize_by_category(&segments);

    Ok(ItemTimelineDto {
        item_uid: first.item_uid.clone(),
        item_name: first.item_name.clone(),
        /* 分类取**第一个块**的快照：同一事项中途改过分类时，历史块各自保留当时的快照，
           上层这一行显示的是这段区间里最早那条记录的分类。 */
        category_key: first.category_key.clone(),
        start_ms: union.first().map(|(start, _)| *start).unwrap_or(from_ms),
        /* `running` 优先：还有一块在跑就显示「进行中」，哪怕别的块早就结束了。 */
        end_ms: if running { None } else { Some(last_end) },
        running,
        total_ms,
        block_count: blocks.len(),
        segments: segments.into_iter().map(ChildSegmentDto::from).collect(),
        gaps,
        totals_by_category: totals,
        /* 取一次 `install_id()`（`OnceLock` 缓存），每行都带：前端按行判断要不要渲染
           设备元素，不需要再发一次取本机 id 的命令。 */
        self_device_id: crate::services::identity::install_id().map(str::to_string),
    })
}
