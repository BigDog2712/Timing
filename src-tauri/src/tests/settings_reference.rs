//! 参考设置（Timing v1.7.3）持久化契约：读写两侧的键与字段必须一一对上。
//!
//! 为什么需要这条：`services::settings::{get_reference, update_reference}` 用**字符串键**
//! 分别做读和写，键名写错一处就会「写得进、读不出」且不报错。这里把所有字段一次性写成
//! 非默认值再读回，逐个断言，等于把 17 组键的双向一致性钉死。

use crate::models::settings::ReferenceSettingsPatch;
use crate::services::settings::{get_reference, update_reference};
use crate::tests::support::fresh_pool;

fn full_patch() -> ReferenceSettingsPatch {
    ReferenceSettingsPatch {
        ui_scale: Some(1.25),
        plate_opacity: Some(0.77),
        default_countdown_minutes: Some(45),
        max_minutes: Some(240),
        auto_write_on_stop: Some(false),
        auto_bind_first_todo: Some(true),
        default_pause_reason: Some("去接水".to_string()),
        merge_gap_minutes: Some(9),
        min_record_seconds: Some(12),
        pending_enabled: Some(false),
        remind_advance_minutes: Some(20),
        light_remind_default_on: Some(false),
        quick_find_enabled: Some(true),
        timer_window_enabled: Some(true),
        extension_auto_start: Some(true),
        highlight_color: Some("#123456".to_string()),
        desktop_menu_enabled: Some(false),
    }
}

#[tokio::test]
async fn reference_settings_round_trip_every_field() {
    let pool = fresh_pool("reference-settings-roundtrip").await;

    // 默认值先验一遍：全新库必须是 DTO 默认，而不是空实现
    let defaults = get_reference(&pool).await.unwrap();
    assert_eq!(defaults.default_countdown_minutes, 25);
    // [V0.3.4] 最短记录时长出厂 30 秒（原 5）——低于此值的手动结束不记录（ADR-023）
    assert_eq!(defaults.min_record_seconds, 30);
    assert!(defaults.pending_enabled);

    let saved = update_reference(&pool, &full_patch()).await.unwrap();
    assert_eq!(saved.ui_scale, 1.25);
    assert_eq!(saved.highlight_color, "#123456");

    // 关键：另起一次读取（走 get 路径，而不是 update 的返回值）
    let read = get_reference(&pool).await.unwrap();
    assert_eq!(read.ui_scale, 1.25);
    assert_eq!(read.plate_opacity, 0.77);
    assert_eq!(read.default_countdown_minutes, 45);
    assert_eq!(read.max_minutes, 240);
    assert!(!read.auto_write_on_stop);
    assert!(read.auto_bind_first_todo);
    assert_eq!(read.default_pause_reason, "去接水");
    assert_eq!(read.merge_gap_minutes, 9);
    assert_eq!(read.min_record_seconds, 12);
    assert!(!read.pending_enabled);
    assert_eq!(read.remind_advance_minutes, 20);
    assert!(!read.light_remind_default_on);
    assert!(read.quick_find_enabled);
    assert!(read.timer_window_enabled);
    assert!(read.extension_auto_start);
    assert_eq!(read.highlight_color, "#123456");
    assert!(!read.desktop_menu_enabled);
}

#[tokio::test]
async fn reference_settings_partial_patch_keeps_the_rest() {
    let pool = fresh_pool("reference-settings-partial").await;
    update_reference(
        &pool,
        &ReferenceSettingsPatch {
            ui_scale: Some(1.1),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let read = get_reference(&pool).await.unwrap();
    assert_eq!(read.ui_scale, 1.1);
    // 未写入的字段必须保持默认（partial patch 不得把别的键清空）
    assert_eq!(read.default_countdown_minutes, 25);
    assert_eq!(read.highlight_color, "#4DA3E8");
    assert!(read.pending_enabled);
}
