//! 悬浮条外观 / 手柄绑定的真源形状（[0.12.1 归一]）。
//!
//! 守的是三件最容易静默写坏的事：
//!  1. **半份 patch 覆盖掉另半份**（设置页的外观卡只发 `appearance`、手柄面板只发 `handles`）；
//!  2. **归一化缺失**（0.05 的不透明度、`triangle` 这种形态、超长 id 一路进库）；
//!  3. **`None` 语义被抹掉**（`pill: None` 是前端的迁移信号，一旦默认成快照，用户 0.12.1
//!     里调过的值就永远迁不进来了）。
//!
//! p1~p4 是纯函数（不碰数据库）；p5 走真实 `update` / `get`，验「写全量、读回来还是它」。

use crate::models::pill_prefs::{
    merge_pill_prefs, HandleBindings, HandleFormBinding, HandleSlotBinding, PillAppearance,
    PillPrefs, PillPrefsPatch, TEXT_OPACITY_MIN,
};
use crate::models::settings::SettingsPatch;
use crate::services::settings::{get, update};
use crate::tests::support::fresh_pool;

fn appearance(text: f64, bg: f64, form: &str) -> PillAppearance {
    PillAppearance {
        text_opacity: text,
        bg_opacity: bg,
        float_form: form.to_string(),
    }
}

fn slots(left: Option<&str>) -> HandleSlotBinding {
    HandleSlotBinding {
        left: left.map(str::to_string),
        ..Default::default()
    }
}

/// 手柄绑定的完整形状（三形态都在），用于验「另半份原样保留」。
fn handles_with_full_enabled() -> HandleBindings {
    let mut handles = HandleBindings::default();
    handles.full = HandleFormBinding {
        enabled: true,
        slots: slots(Some("note.current")),
    };
    handles
}

#[test]
fn p1_default_snapshot_is_bar_and_full_opacity() {
    let prefs = PillPrefs::default();
    assert_eq!(prefs.appearance.float_form, "bar");
    assert_eq!(prefs.appearance.text_opacity, 1.0);
    assert_eq!(prefs.appearance.bg_opacity, 1.0);
    /* 三形态都在、都关：后端默认是「空快照」，出厂值（手柄默认开）由前端兜底并迁移写入 */
    assert!(!prefs.handles.dot.enabled);
    assert!(!prefs.handles.half.enabled);
    assert!(!prefs.handles.full.enabled);
}

#[test]
fn p2_normalize_clamps_and_falls_back_unknown_float_form() {
    /* 下界：0.05 抬到 0.2（常量而不是字面量 —— 前端 `TEXT_OPACITY_MIN` 同值） */
    let mut low = appearance(0.05, 1.5, "dot");
    low.normalize();
    assert_eq!(low.text_opacity, TEXT_OPACITY_MIN);
    /* 上界：bg 1.5 夹到 1.0；`dot` 是合法值，必须保留 */
    assert_eq!(low.bg_opacity, 1.0);
    assert_eq!(low.float_form, "dot");

    /* 未知形态 / 空串一律回落悬浮条（与前端 normalizeFloatForm 同口径） */
    let mut bad = appearance(0.5, 0.5, "triangle");
    bad.normalize();
    assert_eq!(bad.float_form, "bar");

    let mut empty = appearance(0.5, -1.0, "");
    empty.normalize();
    assert_eq!(empty.float_form, "bar");
    assert_eq!(empty.bg_opacity, 0.0);

    /* NaN（手改坏的 JSON）不能留在快照里：落到上界并夹取 */
    let mut nan = appearance(f64::NAN, f64::NAN, "bar");
    nan.normalize();
    assert_eq!(nan.text_opacity, 1.0);
    assert_eq!(nan.bg_opacity, 1.0);
}

#[test]
fn p3_slot_blank_and_overlong_become_none() {
    let overlong = "a".repeat(65);
    let mut binding = HandleSlotBinding {
        left: Some("  ".to_string()),
        right: Some(overlong),
        middle: Some(" timer.start ".to_string()),
        ..Default::default()
    };
    binding.normalize();

    assert_eq!(binding.left, None, "全空白槽必须变成「无」");
    assert_eq!(binding.right, None, "超过 64 字符的 id 必须变成「无」");
    assert_eq!(
        binding.middle,
        Some("timer.start".to_string()),
        "合法的 id 只去掉两端空白，内容不动"
    );
    assert_eq!(binding.left_double, None);
}

#[test]
fn p4_partial_patch_keeps_the_other_half() {
    let old = PillPrefs {
        appearance: appearance(0.4, 0.6, "dot"),
        handles: handles_with_full_enabled(),
    };
    /* 只给 appearance（外观卡的行为）：handles 必须原样留着 */
    let only_appearance = PillPrefsPatch {
        appearance: Some(appearance(0.8, 0.9, "bar")),
        handles: None,
    };
    let merged = merge_pill_prefs(Some(old.clone()), &only_appearance);
    assert_eq!(merged.appearance.text_opacity, 0.8);
    assert_eq!(merged.appearance.float_form, "bar");
    assert_eq!(merged.handles, old.handles);

    /* 反过来只给 handles（手柄面板的行为）：appearance 保持上一次的值 */
    let only_handles = PillPrefsPatch {
        appearance: None,
        handles: Some(HandleBindings::default()),
    };
    let merged = merge_pill_prefs(Some(merged), &only_handles);
    assert_eq!(merged.appearance.text_opacity, 0.8);
    assert_eq!(merged.handles, HandleBindings::default());

    /* 库里没有（`None`）时按默认快照打底，不报错、不 panic */
    let fresh = merge_pill_prefs(None, &only_appearance);
    assert_eq!(fresh.appearance.text_opacity, 0.8);
    assert_eq!(fresh.handles, HandleBindings::default());
}

#[tokio::test]
async fn p5_update_then_get_round_trips_the_whole_snapshot() {
    let pool = fresh_pool("pill-prefs").await;

    /* ① 出厂：`pill` 是 `None` —— 前端的迁移判据 */
    assert!(get(&pool).await.unwrap().pill.is_none());

    /* ② 先写外观那半份 */
    update(
        &pool,
        &SettingsPatch {
            pill: Some(PillPrefsPatch {
                appearance: Some(appearance(0.5, 0.75, "dot")),
                handles: None,
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let after_appearance = get(&pool).await.unwrap().pill.expect("写过之后必须是 Some");
    assert_eq!(after_appearance.appearance.text_opacity, 0.5);
    assert_eq!(after_appearance.appearance.float_form, "dot");
    assert_eq!(after_appearance.handles, HandleBindings::default());

    /* ③ 再写手柄那半份：外观必须还在（这就是「读旧 → 覆盖 → 写全量」） */
    update(
        &pool,
        &SettingsPatch {
            pill: Some(PillPrefsPatch {
                appearance: None,
                handles: Some(handles_with_full_enabled()),
            }),
            ..Default::default()
        },
    )
    .await
    .unwrap();

    let after_handles = get(&pool).await.unwrap().pill.expect("写过之后必须是 Some");
    assert_eq!(after_handles.appearance.text_opacity, 0.5, "半份 patch 不许抹掉外观");
    assert_eq!(after_handles.appearance.float_form, "dot");
    assert!(after_handles.handles.full.enabled);
    assert_eq!(
        after_handles.handles.full.slots.left,
        Some("note.current".to_string())
    );
}
