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
use super::{slice_block, summarize_by_category, BlockSpan, FactSpan, SegmentOverride};
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
