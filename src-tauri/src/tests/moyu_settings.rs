//! 常用摸鱼 / 常用事项框偏好的持久化契约（V0.3.9）。
//!
//! 三组键（`moyu.presets` / `items.show_recent` / `items.recent_count`）走 settings KV，
//! 与 `countdown.presets` 同一口径：JSON 整表覆盖 + 顺序即展示顺序。
//! 这里钉住「写进去什么、另起一次读出来还是什么」以及归一化边界。

use std::collections::HashMap;

use crate::models::moyu::{MoyuMode, MoyuPreset};
use crate::models::settings::SettingsPatch;
use crate::services::settings::{get, moyu_presets, update};
use crate::tests::support::fresh_pool;

fn preset(id: &str, item: &str, minutes: i64, mode: MoyuMode) -> MoyuPreset {
    MoyuPreset {
        id: id.to_string(),
        item: item.to_string(),
        minutes,
        mode,
    }
}

#[tokio::test]
async fn defaults_are_factory_three_and_show_recent() {
    let pool = fresh_pool("moyu-defaults").await;
    let settings = get(&pool).await.unwrap();
    assert_eq!(settings.moyu_presets.len(), 3);
    assert_eq!(settings.moyu_presets[1].item, "摸鱼");
    assert_eq!(settings.moyu_presets[1].minutes, 25);
    assert!(settings.items_show_recent);
    assert_eq!(settings.items_recent_count, 5);
}

#[tokio::test]
async fn presets_round_trip_keeps_order_and_mode() {
    let pool = fresh_pool("moyu-roundtrip").await;
    let list = vec![
        preset("b", "回邮件", 15, MoyuMode::Countdown),
        preset("a", "刷手机", 10, MoyuMode::Countup),
    ];
    update(
        &pool,
        &SettingsPatch {
            moyu_presets: Some(list.clone()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    // 另起一次读取（走 get 路径）
    let read = get(&pool).await.unwrap();
    assert_eq!(read.moyu_presets, list);
    assert_eq!(read.moyu_presets[0].item, "回邮件");
    assert_eq!(read.moyu_presets[1].mode, MoyuMode::Countup);
}

#[tokio::test]
async fn empty_list_is_a_valid_state() {
    let pool = fresh_pool("moyu-empty").await;
    update(
        &pool,
        &SettingsPatch {
            moyu_presets: Some(Vec::new()),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let read = moyu_presets(&pool).await.unwrap();
    assert!(
        read.is_empty(),
        "删光常用摸鱼应保持为空，而不是回落出厂三条"
    );
}

#[tokio::test]
async fn invalid_entries_are_normalized() {
    let pool = fresh_pool("moyu-normalize").await;
    update(
        &pool,
        &SettingsPatch {
            moyu_presets: Some(vec![
                preset("", "   ", 10, MoyuMode::Countdown),
                preset("x", "  长名  ", 0, MoyuMode::Countdown),
                preset("x", "第二条", 9999, MoyuMode::Countup),
            ]),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let read = moyu_presets(&pool).await.unwrap();
    assert_eq!(read.len(), 2, "空名应被丢弃");
    assert_eq!(read[0].item, "长名");
    assert_eq!(read[0].minutes, 1);
    assert_eq!(read[1].minutes, 1440);
    assert_ne!(read[0].id, read[1].id, "重复 id 应被补齐");
}

#[tokio::test]
async fn recent_prefs_are_clamped() {
    let pool = fresh_pool("items-recent-prefs").await;
    let saved = update(
        &pool,
        &SettingsPatch {
            items_show_recent: Some(false),
            items_recent_count: Some(99),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(!saved.items_show_recent);
    assert_eq!(saved.items_recent_count, 10);

    let saved = update(
        &pool,
        &SettingsPatch {
            items_recent_count: Some(0),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.items_recent_count, 1);
}

/// 常用事项默认倒计时（itemId → 分钟）：往返保序不需要（Map），但**归一化边界**要钉住。
#[tokio::test]
async fn item_timers_round_trip_and_normalize() {
    let pool = fresh_pool("items-timers").await;
    let mut patch = HashMap::new();
    patch.insert(2_i64, 25_i64);
    patch.insert(3_i64, 0_i64); // 低于下限 → 丢弃
    patch.insert(0_i64, 10_i64); // 非法 itemId → 丢弃
    patch.insert(4_i64, 9_999_i64); // 超出上限 → 丢弃

    let saved = update(
        &pool,
        &SettingsPatch {
            items_timers: Some(patch),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert_eq!(saved.items_timers.len(), 1, "越界项应被归一化丢弃");
    assert_eq!(saved.items_timers.get(&2), Some(&25));

    // 另起一次读取（走 get 路径）仍能拿到
    let read = get(&pool).await.unwrap();
    assert_eq!(read.items_timers.get(&2), Some(&25));

    // 清空是合法状态（= 全部改回正计时）
    let cleared = update(
        &pool,
        &SettingsPatch {
            items_timers: Some(HashMap::new()),
            ..Default::default()
        },
    )
    .await
    .unwrap();
    assert!(cleared.items_timers.is_empty());
}
