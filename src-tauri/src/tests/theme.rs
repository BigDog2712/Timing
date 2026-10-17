//! 主题 / 四色 / 倒计时预设（V0.2.0 批 1 · A2）。
//!
//! 断言来源：`docs/Spec-V0.2.0.md §5.4`、`ADR-012`、`docs/phase2/schema-V0.2.0.sql` 种子、
//! `src/types/domain-v020.ts`。以行为（输入 -> 可观测输出 / 错误码）为准。
//!
//! 注：本文件出现的 hex 字面量均为**期望值**（= schema 种子 / 设计令牌，权威），非产品实现。

use crate::error::ErrorCode;
use crate::models::theme::{AccentPatch, ThemeMode};
use crate::services::theme;
use crate::tests::support::{expect_err, fresh_pool};

/* --------------------------------- 主题模式 --------------------------------- */

#[tokio::test]
async fn theme_defaults_to_dark() {
    let pool = fresh_pool("theme-default").await;
    assert_eq!(theme::mode(&pool).await.unwrap(), ThemeMode::Dark);
    assert_eq!(theme::settings(&pool).await.unwrap().mode, ThemeMode::Dark);
}

#[tokio::test]
async fn theme_set_round_trips_all_modes() {
    let pool = fresh_pool("theme-roundtrip").await;
    for mode in [ThemeMode::Light, ThemeMode::System, ThemeMode::Dark] {
        assert_eq!(theme::set_mode(&pool, mode).await.unwrap(), mode);
        assert_eq!(theme::mode(&pool).await.unwrap(), mode, "读回应与写入一致");
        assert_eq!(theme::settings(&pool).await.unwrap().mode, mode);
    }
}

#[test]
fn theme_mode_wire_format() {
    // 与 domain-v020.ts 联合类型 'dark' | 'light' | 'system' 对齐
    assert_eq!(serde_json::to_string(&ThemeMode::Dark).unwrap(), "\"dark\"");
    assert_eq!(
        serde_json::to_string(&ThemeMode::System).unwrap(),
        "\"system\""
    );
    assert_eq!(
        serde_json::from_str::<ThemeMode>("\"light\"").unwrap(),
        ThemeMode::Light
    );
    assert!(
        serde_json::from_str::<ThemeMode>("\"neon\"").is_err(),
        "非法值应被拒绝"
    );
}

/* --------------------------------- 四色可配 --------------------------------- */

#[tokio::test]
async fn accent_defaults_match_seed() {
    let pool = fresh_pool("accent-default").await;
    let a = theme::accents(&pool).await.unwrap();
    assert_eq!(a.running, "#4DA3E8");
    assert_eq!(a.warn, "#E8A33D");
    assert_eq!(a.done, "#4CC38A");
    assert_eq!(a.bar, None, "bar 默认跟随主题（null）");
}

#[tokio::test]
async fn accent_set_partial_update_keeps_others() {
    let pool = fresh_pool("accent-partial").await;
    let patch = AccentPatch {
        running: Some("#112233".into()),
        ..Default::default()
    };
    let a = theme::set_accents(&pool, &patch).await.unwrap();
    assert_eq!(a.running, "#112233");
    assert_eq!(a.warn, "#E8A33D", "未触及字段应保持不变");
    assert_eq!(a.done, "#4CC38A");
    // 持久化生效
    assert_eq!(theme::accents(&pool).await.unwrap().running, "#112233");
}

#[tokio::test]
async fn accent_set_rejects_invalid_hex() {
    let pool = fresh_pool("accent-invalid").await;
    for bad in ["red", "#12345", "#1234567", "112233", "#GGGGGG", ""] {
        let patch = AccentPatch {
            running: Some(bad.to_string()),
            ..Default::default()
        };
        assert_eq!(
            expect_err(theme::set_accents(&pool, &patch).await),
            ErrorCode::InvalidColor,
            "非法色值 {bad:?} 应返回 INVALID_COLOR"
        );
    }
}

#[tokio::test]
async fn accent_set_rejects_whole_batch_on_any_invalid() {
    // 一批中既有合法又有非法 → 整批拒绝，合法项也不落盘（避免半成功）
    let pool = fresh_pool("accent-atomic").await;
    let before = theme::accents(&pool).await.unwrap();
    let patch = AccentPatch {
        running: Some("#00FF00".into()),
        warn: Some("not-a-color".into()),
        ..Default::default()
    };
    assert_eq!(
        expect_err(theme::set_accents(&pool, &patch).await),
        ErrorCode::InvalidColor
    );
    assert_eq!(
        theme::accents(&pool).await.unwrap(),
        before,
        "整批拒绝后应无副作用"
    );
}

#[tokio::test]
async fn accent_bar_tri_state() {
    let pool = fresh_pool("accent-bar").await;
    // 显式设值
    let patch = AccentPatch {
        bar: Some(Some("#ABCDEF".into())),
        ..Default::default()
    };
    assert_eq!(
        theme::set_accents(&pool, &patch)
            .await
            .unwrap()
            .bar
            .as_deref(),
        Some("#ABCDEF")
    );
    // 缺省 → 不修改
    let patch = AccentPatch {
        running: Some("#101010".into()),
        ..Default::default()
    };
    assert_eq!(
        theme::set_accents(&pool, &patch)
            .await
            .unwrap()
            .bar
            .as_deref(),
        Some("#ABCDEF"),
        "bar 缺省不应清除既有值"
    );
    // 显式 null → 重置为跟随主题
    let patch = AccentPatch {
        bar: Some(None),
        ..Default::default()
    };
    assert_eq!(theme::set_accents(&pool, &patch).await.unwrap().bar, None);
}

#[test]
fn accent_patch_deserializes_tri_state_bar() {
    // 字段缺省 = 不修改
    let absent: AccentPatch = serde_json::from_str("{}").unwrap();
    assert_eq!(absent.bar, None);
    // 显式 null = 重置为跟随主题
    let null: AccentPatch = serde_json::from_str(r#"{"bar":null}"#).unwrap();
    assert_eq!(null.bar, Some(None));
    // 有值 = 设置该色
    let value: AccentPatch = serde_json::from_str(r##"{"bar":"#AABBCC"}"##).unwrap();
    assert_eq!(value.bar, Some(Some("#AABBCC".to_string())));
}

/* --------------------------------- 倒计时预设 -------------------------------- */

#[tokio::test]
async fn presets_default_and_normalize() {
    let pool = fresh_pool("presets").await;
    assert_eq!(
        theme::presets(&pool).await.unwrap(),
        vec![300, 900, 1500, 1800, 2700, 3600]
    );
    // 归一：去重 + 升序 + 剔除非正
    let stored = theme::set_presets(&pool, vec![900, 300, 900, -5, 0, 1800])
        .await
        .unwrap();
    assert_eq!(stored, vec![300, 900, 1800]);
    assert_eq!(theme::presets(&pool).await.unwrap(), vec![300, 900, 1800]);
}

/* --------------------------------- 事件载荷 --------------------------------- */

#[tokio::test]
async fn changed_payload_carries_mode_and_accents() {
    let pool = fresh_pool("theme-changed").await;
    theme::set_mode(&pool, ThemeMode::Light).await.unwrap();
    let patch = AccentPatch {
        done: Some("#00AA00".into()),
        ..Default::default()
    };
    theme::set_accents(&pool, &patch).await.unwrap();

    let payload = theme::changed(&pool).await.unwrap();
    assert_eq!(payload.mode, ThemeMode::Light);
    assert_eq!(payload.accents.done, "#00AA00");
    assert_eq!(payload.accents.bar, None);
}
