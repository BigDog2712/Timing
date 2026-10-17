//! 多窗口规格（V0.2.0 批 1 · A3 设置窗 / B2 事项窗；批 2 · 便利贴窗）：`label -> 几何/属性` 映射。
//!
//! 断言来源：`ADR-009`（窗口目录）、`ARCHITECTURE-V0.2.0 §6.a`、
//! `docs/design/pages-V0.2.0/{settings-panel,todos-panel,sticky-note}.md`。

use crate::infra::window_spec::{note_label, spec_for, NOTE, NOTE_LABEL_PREFIX, SETTINGS, TODOS};

#[test]
fn settings_spec_matches_adr_009() {
    let spec = spec_for("settings").expect("settings 应已登记");
    assert_eq!(spec.label, "settings", "label 固定");
    assert_eq!((spec.width, spec.height), (392.0, 660.0), "尺寸 392×660");
    assert!(!spec.resizable, "设置窗不可缩放");
    assert!(
        spec.min_width <= spec.width && spec.min_height <= spec.height,
        "最小尺寸不应大于默认尺寸"
    );
    assert!(!spec.always_on_top, "设置窗不置顶");
}

/// 固定尺寸窗不变量：min == max == 尺寸（防 window-state 物理像素回填后在跨 DPI 显示器漂移，K-15）。
#[test]
fn fixed_size_spec_pins_min_and_max() {
    let spec = spec_for("settings").unwrap();
    assert!(!spec.resizable, "本用例只对固定尺寸窗生效");
    assert_eq!(
        (spec.min_width, spec.min_height),
        (spec.width, spec.height),
        "固定尺寸窗 min 应等尺寸"
    );
    assert_eq!(
        (spec.max_width, spec.max_height),
        (spec.width, spec.height),
        "固定尺寸窗 max 应等尺寸（跨 DPI 回填时由 WM 夹回）"
    );
}

#[test]
fn settings_window_reuses_anti_flash_trio() {
    // K-18 防白闪三件套之一：透明底（早显为不可见）；无系统标题栏（页面内自绘标题栏）。
    let spec = spec_for("settings").unwrap();
    assert!(spec.transparent, "应透明底（配合圆角自绘外壳 / 防白闪）");
    assert!(
        !spec.decorations,
        "应无系统标题栏（页面内自绘 + drag region）"
    );
}

#[test]
fn settings_url_routes_to_settings_view() {
    let spec = spec_for("settings").unwrap();
    assert!(
        spec.url.contains("index.html"),
        "应加载同一 index.html：{}",
        spec.url
    );
    assert!(
        spec.url.contains("w=settings"),
        "应按 label 路由：{}",
        spec.url
    );
}

#[test]
fn unknown_label_has_no_spec() {
    assert!(
        spec_for("main").is_none(),
        "主窗由 tauri.conf.json 声明，不入本表（避免重复来源）"
    );
    assert!(
        spec_for("note").is_none(),
        "基名 `note` 非实际 label（须带 id）"
    );
    assert!(spec_for("").is_none());
    assert!(spec_for("settings-extra").is_none(), "未登记 label 不匹配");
}

/// 事项窗口（V0.2.0 批 1 · B2）：宽 336、高自适应 [360, 560]、限高可缩放。
/// 断言来源：ADR-009 窗口目录 / ARCHITECTURE-V0.2.0 §6.a；max 高取 todos-panel.md §1。
#[test]
fn todos_spec_matches_adr_009() {
    let spec = spec_for("todos").expect("todos 应已登记");
    assert_eq!(spec.label, "todos", "label 固定");
    assert_eq!(spec.width, 336.0, "宽固定 336");
    assert_eq!(spec.width, spec.min_width, "宽度下限 = 336");
    assert_eq!(spec.width, spec.max_width, "宽度上限 = 336（不可横向缩放）");
    assert_eq!(spec.min_height, 360.0, "登记值 min 高 360");
    assert_eq!(spec.max_height, 560.0, "设计稿最大高 560");
    assert!(
        spec.min_height <= spec.height && spec.height <= spec.max_height,
        "默认高应落在 [min, max]"
    );
    assert!(spec.resizable, "事项窗允许缩放（限高）");
    assert!(!spec.always_on_top, "事项窗不置顶");
    assert!(
        spec.url.contains("w=todos"),
        "应按 label 路由：{}",
        spec.url
    );
}

#[test]
fn todos_window_reuses_anti_flash_trio() {
    // K-18 防白闪三件套之一：透明底（早显为不可见）；无系统标题栏（页面内自绘标题栏）。
    let spec = spec_for("todos").unwrap();
    assert!(spec.transparent, "应透明底（配合圆角自绘外壳 / 防白闪）");
    assert!(
        !spec.decorations,
        "应无系统标题栏（页面内自绘 + drag region）"
    );
}

#[test]
fn constant_and_lookup_are_consistent() {
    let spec = spec_for(SETTINGS.label).expect("常量 label 应可回查");
    assert_eq!(*spec, SETTINGS);
    let todos = spec_for(TODOS.label).expect("todos 常量 label 应可回查");
    assert_eq!(*todos, TODOS);
}

/* --------------------------- 便利贴窗（V0.2.0 批 2 · ADR-009） --------------------------- */

/// 动态 label `note-{id}` 复用同一 `NOTE` 规格；几何由 DB 行另行提供。
#[test]
fn note_label_prefix_maps_to_note_spec() {
    for id in [1_i64, 42, 999] {
        let label = note_label(id);
        assert_eq!(
            label,
            format!("{NOTE_LABEL_PREFIX}{id}"),
            "label 形如 note-{{id}}"
        );
        let spec = spec_for(&label).expect("note-{id} 应已登记");
        assert_eq!(*spec, NOTE, "所有便利贴窗复用同一规格模板");
    }
}

/// 硬钳制尺寸 [160,120]~[900,900]（sticky-note.md §默认尺寸与约束）。
#[test]
fn note_spec_matches_sticky_note_bounds() {
    assert_eq!(
        (NOTE.width, NOTE.height),
        (320.0, 232.0),
        "默认尺寸 320×232"
    );
    assert_eq!(
        (NOTE.min_width, NOTE.min_height),
        (160.0, 120.0),
        "硬钳制下限"
    );
    assert_eq!(
        (NOTE.max_width, NOTE.max_height),
        (900.0, 900.0),
        "硬钳制上限"
    );
    const { assert!(NOTE.resizable, "便利贴可缩放") };
}

/// 便利贴为桌面配件：默认置顶（AC-64）、不上任务栏、透明底 + 无系统标题栏（K-18 防白闪）。
#[test]
fn note_window_is_desktop_widget() {
    const {
        assert!(NOTE.always_on_top, "默认置顶（AC-64）");
        assert!(NOTE.skip_taskbar, "不上任务栏");
        assert!(NOTE.transparent, "透明底（圆角自绘外壳 / 防白闪）");
        assert!(
            !NOTE.decorations,
            "无系统标题栏（页面内自绘 + drag region）"
        );
    }
}

#[test]
fn note_url_routes_to_note_view() {
    assert!(
        NOTE.url.contains("index.html"),
        "应加载同一 index.html：{}",
        NOTE.url
    );
    assert!(NOTE.url.contains("w=note"), "应按 label 路由：{}", NOTE.url);
}
