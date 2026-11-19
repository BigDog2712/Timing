//! 设备维度的切片判据（从 `slice_tests.rs` 拆出：那边已到 300 行硬限）。
//!
//! 只关心一件事：**同一应用双端并行时是两段各有设备的记录，不是「这一条被记了两遍」**。
//! 丢设备归属不会让任何数字变错，只会让「双端并行」这件事在界面上不可见。

use std::collections::BTreeMap;

use super::{slice_block, BlockSpan, FactSpan, SegmentOverride};
use crate::services::activity::data::attribution::AppCategory;

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

fn fact_on(device: &str, app: &str, start_ms: i64, end_ms: i64) -> FactSpan {
    FactSpan {
        app_key: app.to_string(),
        app_name: app.to_string(),
        device_id: device.to_string(),
        start_ms,
        end_ms,
    }
}

/// 用户的第一反应是「重复记录了」。丢设备归属不会报错，只会让双端并行这件事**不可见**。
#[test]
fn segments_keep_the_device_that_produced_them() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 120,
        category_key: Some("study".to_string()),
    };
    let facts = vec![
        fact_on("pc-1", "chrome", 0, 30),
        fact_on("phone-2", "chrome", 30, 60),
    ];
    let segments = slice_block(&block, &facts, &categories(&[("chrome", &["study"])]), &[]);
    assert_eq!(segments.len(), 2);
    assert_eq!(segments[0].device_id, "pc-1");
    assert_eq!(segments[1].device_id, "phone-2");
}

/// 切片改写分类，但不改写设备（覆盖分支同样要带 `device_id`）。
#[test]
fn an_override_changes_the_category_but_not_the_device() {
    let block = BlockSpan {
        start_ms: 0,
        end_ms: 60,
        category_key: Some("game".to_string()),
    };
    let facts = vec![fact_on("phone-2", "chrome", 0, 60)];
    let overrides = vec![SegmentOverride {
        app_key: "chrome".to_string(),
        seg_start_ms: 0,
        category_key: Some("moyu".to_string()),
        excluded: false,
    }];
    let segments = slice_block(
        &block,
        &facts,
        &categories(&[("chrome", &["game"])]),
        &overrides,
    );
    assert_eq!(segments[0].category_key, "moyu");
    assert_eq!(segments[0].device_id, "phone-2");
}
