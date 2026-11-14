//! 切片验收：需求原文里的五条记录逐条变成用例。
//!
//! ```
//! 记录：事项:学习SQL-分类:学习-9:30-11:30
//!   子记录 应用:chrome-分类:学习-9:30-11:00
//!   子记录 应用:pycharm-分类:学习-11:10-11:30
//!   子记录 手机:bilibili-分类:摸鱼-11:00-11:20
//! ```

use std::collections::BTreeMap;

/* 本文件是 `slice.rs` 的子模块（`#[path]` 挂载），所以 `super` 就是切片本身，
   而 `AppCategory` 要回到 attribution 层取。 */
use super::{
    gaps_within, slice_block, summarize_by_category, union_ranges, BlockSpan, FactSpan,
    SegmentOverride,
};
use crate::services::insight::data::attribution::AppCategory;

/// 把「应用 → [(分类, priority)]」写成 `BTreeMap`（顺序即输入的 priority）。
fn categories(entries: &[(&str, &[&str])]) -> BTreeMap<String, Vec<AppCategory>> {
    let mut map = BTreeMap::new();
    for (app, keys) in entries {
        map.insert(
            app.to_string(),
            keys.iter()
                .enumerate()
                .map(|(index, key)| AppCategory::new(key, index as i64))
                .collect(),
        );
    }
    map
}

fn fact(app: &str, start_ms: i64, end_ms: i64) -> FactSpan {
    FactSpan {
        app_key: app.to_string(),
        app_name: app.to_string(),
        start_ms,
        end_ms,
    }
}

/// 需求原文：学习SQL 块里三台应用，分类各按规则落位。
#[test]
fn the_original_example_slices_into_three_child_records() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 120,
        category_key: Some("study".to_string()),
    };
    let facts = [
        fact("chrome", 0, 90),
        fact("pycharm", 100, 120),
        fact("bilibili", 90, 110),
    ];
    let cats = categories(&[
        ("chrome", &["study", "work", "fun", "game"]),
        ("pycharm", &["study"]),
        // 手机端 bilibili 的「摸鱼」排首位 → 规则 2 命中
        ("bilibili", &["moyu", "fun"]),
    ]);
    let segments = slice_block(&block, &facts, &cats, &[]);
    let summary: Vec<(&str, &str, i64)> = segments
        .iter()
        .map(|s| (s.app_key.as_str(), s.category_key.as_str(), s.duration_ms()))
        .collect();
    assert_eq!(
        summary,
        [
            ("chrome", "study", 90),
            ("bilibili", "moyu", 20),
            ("pycharm", "study", 20),
        ]
    );
}

/// chrome 在「游戏」事项里记游戏（规则 1），在「学习」里记学习 —— 同一个应用，两个结果。
#[test]
fn the_same_app_resolves_differently_under_different_items() {
    let cats = categories(&[("chrome", &["fun", "study", "game"])]);
    let facts = [fact("chrome", 0, 60)];

    let studying = slice_block(
        &BlockSpan {
            start_ms: 0,
            end_ms: 60,
            category_key: Some("study".to_string()),
        },
        &facts,
        &cats,
        &[],
    );
    let gaming = slice_block(
        &BlockSpan {
            start_ms: 0,
            end_ms: 60,
            category_key: Some("game".to_string()),
        },
        &facts,
        &cats,
        &[],
    );
    assert_eq!(studying[0].category_key, "study");
    assert_eq!(gaming[0].category_key, "game");
}

/// 事实比块长：裁到块内，而不是把整条事实算进来。
#[test]
fn facts_are_clipped_to_the_block() {
    let block = BlockSpan {
        start_ms: 30,
        end_ms: 60,
        category_key: None,
    };
    let facts = [fact("chrome", 0, 120)];
    let segments = slice_block(&block, &facts, &BTreeMap::new(), &[]);
    assert_eq!(segments.len(), 1);
    assert_eq!((segments[0].start_ms, segments[0].end_ms), (30, 60));
    assert_eq!(segments[0].duration_ms(), 30);
}

/// 不相交、零长的边界一律丢弃：界面上不该出现「0 分钟的 chrome」。
#[test]
fn non_overlapping_and_zero_length_facts_are_dropped() {
    let block = BlockSpan {
        start_ms: 30,
        end_ms: 60,
        category_key: None,
    };
    let facts = [
        fact("before", 0, 30),
        fact("after", 60, 90),
        fact("touching", 60, 60),
    ];
    assert!(slice_block(&block, &facts, &BTreeMap::new(), &[]).is_empty());
}

/// 手工改判优先于规则；`excluded` 直接不出现。
#[test]
fn overrides_win_over_the_rules_and_can_exclude() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 100,
        category_key: Some("study".to_string()),
    };
    let facts = [fact("chrome", 0, 50), fact("bilibili", 50, 100)];
    let cats = categories(&[("chrome", &["study"]), ("bilibili", &["moyu"])]);
    let overrides = [
        SegmentOverride {
            app_key: "chrome".to_string(),
            seg_start_ms: 0,
            category_key: Some("research".to_string()),
            excluded: false,
        },
        SegmentOverride {
            app_key: "bilibili".to_string(),
            seg_start_ms: 50,
            category_key: None,
            excluded: true,
        },
    ];
    let segments = slice_block(&block, &facts, &cats, &overrides);
    assert_eq!(segments.len(), 1);
    assert_eq!(segments[0].app_key, "chrome");
    assert_eq!(segments[0].category_key, "research");
}

/// 应用没有任何分类时落 `other`，不许空串（空串会让图例多出一个无名色块）。
#[test]
fn an_app_without_categories_falls_back_to_other() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 10,
        category_key: Some("study".to_string()),
    };
    let segments = slice_block(&block, &[fact("unknown", 0, 10)], &BTreeMap::new(), &[]);
    assert_eq!(segments[0].category_key, "other");
}

/// 汇总按分类累计（同一应用可能在不同块里落到不同分类）。
#[test]
fn summary_totals_by_category_not_by_app() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 100,
        category_key: Some("study".to_string()),
    };
    let facts = [fact("chrome", 0, 40), fact("pycharm", 40, 100)];
    let cats = categories(&[("chrome", &["study"]), ("pycharm", &["study"])]);
    let totals = summarize_by_category(&slice_block(&block, &facts, &cats, &[]));
    assert_eq!(totals.get("study").copied(), Some(100));
}

/* ---------------------------------------------------------------------------
   区间并集 / 空档：双层渲染的两条口径，各自对应一种「零报错算错」
   --------------------------------------------------------------------------- */

/// 双端并行：PC 09:30–11:30 + 手机 10:00–10:40，并集必须是 2 小时不是 2 小时 40 分。
///
/// 这是「按块求和」的经典失效：数字看起来合理（比单端多），只有在两端都同步过完整历史
/// 之后才会发现「这天怎么多算了 40 分钟」。
#[test]
fn overlapping_blocks_union_instead_of_summing() {
    assert_eq!(union_ranges(&[(0, 120), (30, 70)]), vec![(0, 120)]);
    let total: i64 = union_ranges(&[(0, 120), (30, 70)])
        .iter()
        .map(|(start, end)| end - start)
        .sum();
    assert_eq!(total, 120, "并集 120 而不是 190");
}

/// 完全嵌套：`LAG` 式写法会把它判成两段独立区间（少算且零报错）。
#[test]
fn a_fully_nested_range_does_not_create_a_second_segment() {
    assert_eq!(union_ranges(&[(0, 100), (20, 40)]), vec![(0, 100)]);
    // 输入顺序反过来也必须一样：并集不该依赖调用方给的顺序。
    assert_eq!(union_ranges(&[(20, 40), (0, 100)]), vec![(0, 100)]);
}

/// 相邻接上：09:30–10:00 与 10:00–10:30 之间没有缝，合成一段。
#[test]
fn adjacent_ranges_merge_because_there_is_no_hole_between_them() {
    assert_eq!(union_ranges(&[(0, 30), (30, 60)]), vec![(0, 60)]);
}

/// 零长与倒挂的区间在入口丢掉，否则并集会比原始数据还长。
#[test]
fn zero_length_and_inverted_ranges_are_dropped() {
    assert!(union_ranges(&[(10, 10), (20, 5)]).is_empty());
}

/// 块 09:30–11:30、事实只到 11:00 ⇒ 11:00–11:30 是「未采集」，必须显式产出。
///
/// 显示 0 会让用户以为计时坏了；不显示则块与子记录的时长对不上，
/// 而两种表现都不会有任何报错。
#[test]
fn the_unmeasured_tail_is_reported_as_a_gap_not_as_zero() {
    let blocks = union_ranges(&[(0, 120)]);
    let children = union_ranges(&[(0, 90)]);
    assert_eq!(gaps_within(&blocks, &children), vec![(90, 120)]);
}

/// 事实跨出块边界的那部分**不算空档**（它已经被切掉了，不是「没采集到」）。
#[test]
fn a_gap_never_extends_beyond_the_block() {
    let blocks = union_ranges(&[(30, 60)]);
    let children = union_ranges(&[(0, 30)]);
    assert_eq!(gaps_within(&blocks, &children), vec![(30, 60)]);
}

/// 块内完全没有事实 ⇒ 整块都是空档。
#[test]
fn a_block_without_facts_is_one_whole_gap() {
    assert_eq!(gaps_within(&[(0, 60)], &[]), vec![(0, 60)]);
}
