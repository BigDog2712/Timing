//! 多显示器工作区钳制纯函数单测（Spec §9 AC-23 / K-6）。
//! 覆盖：单屏、双屏（水平）、完全越界、部分越界、矩形大于工作区（收缩）、
//! 主屏缺失兜底、无显示器兜底、幂等稳定。
//! 口径：全部为**物理像素**，不涉及 scale_factor。

use crate::infra::geometry::{clamp_to_workarea, Rect, WorkArea};

fn rect(x: i32, y: i32, w: u32, h: u32) -> Rect {
    Rect::new(x, y, w, h)
}

fn area(x: i32, y: i32, w: u32, h: u32, primary: bool) -> WorkArea {
    WorkArea {
        rect: rect(x, y, w, h),
        primary,
    }
}

#[test]
fn single_monitor_inside_is_unchanged() {
    let monitors = [area(0, 0, 1920, 1040, true)];
    let window = rect(100, 100, 384, 360);
    assert_eq!(clamp_to_workarea(window, &monitors), window);
}

#[test]
fn dual_monitor_horizontal_on_secondary_is_unchanged() {
    // 左屏为主屏，右屏非主屏；窗口完整落在右屏内 → 原样返回。
    let monitors = [
        area(0, 0, 1920, 1040, true),
        area(1920, 0, 1920, 1040, false),
    ];
    let window = rect(2000, 200, 384, 360);
    assert_eq!(clamp_to_workarea(window, &monitors), window);
}

#[test]
fn fully_outside_moves_to_primary_workarea_center() {
    let monitors = [
        area(0, 0, 1920, 1040, true),
        area(1920, 0, 1920, 1040, false),
    ];
    let window = rect(-5000, -5000, 384, 360);
    // 主屏中心：(1920-384)/2=768, (1040-360)/2=340
    assert_eq!(
        clamp_to_workarea(window, &monitors),
        rect(768, 340, 384, 360)
    );
}

#[test]
fn partial_overlap_with_monitor_is_unchanged() {
    // 窗口横跨主屏边界、仅部分可见（有正面积交集）→ 依规则原样返回。
    let monitors = [area(0, 0, 1920, 1040, true)];
    let window = rect(1900, 200, 384, 360);
    assert_eq!(clamp_to_workarea(window, &monitors), window);
}

#[test]
fn straddling_corner_with_partial_overlap_is_unchanged() {
    // 左上角越界但仍与工作区有交集 → 原样返回。
    let monitors = [area(0, 0, 1920, 1040, true)];
    let window = rect(-300, -300, 384, 360);
    assert_eq!(clamp_to_workarea(window, &monitors), window);
}

#[test]
fn rect_larger_than_workarea_is_shrunk_and_centered() {
    let monitors = [area(0, 0, 1920, 1040, true)];
    let window = rect(10_000, 10_000, 3840, 2160);
    // 收缩至工作区尺寸并居中 → 完全落入且尺寸等于工作区。
    assert_eq!(clamp_to_workarea(window, &monitors), rect(0, 0, 1920, 1040));
}

#[test]
fn missing_primary_falls_back_to_first_monitor() {
    // 无任何显示器标记为主屏 → 兜底取列表首个。
    let monitors = [
        area(0, 0, 1920, 1040, false),
        area(1920, 0, 1920, 1040, false),
    ];
    let window = rect(-5000, -5000, 384, 360);
    assert_eq!(
        clamp_to_workarea(window, &monitors),
        rect(768, 340, 384, 360)
    );
}

#[test]
fn primary_preferred_over_list_order() {
    // 即使主屏不是列表首个，也应优先选主屏（左屏）而非右屏。
    let monitors = [
        area(1920, 0, 1920, 1040, false),
        area(0, 0, 1920, 1040, true),
    ];
    let window = rect(-5000, -5000, 384, 360);
    assert_eq!(
        clamp_to_workarea(window, &monitors),
        rect(768, 340, 384, 360)
    );
}

#[test]
fn no_monitors_returns_unchanged() {
    let window = rect(-5000, -5000, 384, 360);
    assert_eq!(clamp_to_workarea(window, &[]), window);
}

#[test]
fn clamped_result_is_stable() {
    // 钳制结果再次钳制应保持不变（幂等），且完整落在工作区内。
    let monitors = [
        area(0, 0, 1920, 1040, true),
        area(1920, 0, 1920, 1040, false),
    ];
    let once = clamp_to_workarea(rect(-9999, -9999, 384, 360), &monitors);
    let twice = clamp_to_workarea(once, &monitors);
    assert_eq!(once, twice);
    assert_eq!(once, rect(768, 340, 384, 360));
}
