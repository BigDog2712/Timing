//! `geometry.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
fn monitor(name: &str, x: i32, y: i32, width: u32, height: u32) -> MonitorAffinity {
    MonitorAffinity::new(
        Some(name.to_string()),
        PhysicalRect::new(x, y, width, height),
    )
}

#[test]
fn monitor_selection_uses_final_rect_instead_of_source_monitor_state() {
    let monitors = [
        monitor(r"\\.\DISPLAY1", 0, 0, 1920, 1040),
        monitor(r"\\.\DISPLAY2", 1920, 0, 2560, 1392),
    ];
    let final_rect = PhysicalRect::new(2200, 300, 80, 60);

    assert_eq!(select_monitor(&final_rect, &monitors), Some(1));
}

#[test]
fn release_point_owns_the_target_when_the_window_still_straddles_the_source_monitor() {
    let monitors = [
        monitor("primary", 0, 0, 1920, 1040),
        monitor("secondary", 1920, 0, 2560, 1392),
    ];
    let straddling_window = PhysicalRect::new(1840, 300, 96, 72);
    let release_on_secondary = PhysicalPoint::new(1928, 336);

    assert_eq!(select_monitor(&straddling_window, &monitors), Some(0));
    assert_eq!(
        select_monitor_for_release(release_on_secondary, &monitors),
        Some(1)
    );
}

#[test]
fn monitor_selection_handles_negative_and_vertical_origins() {
    let monitors = [
        monitor("primary", 0, 0, 1920, 1040),
        monitor("left", -2560, 100, 2560, 1392),
        monitor("above", 0, -1440, 2560, 1400),
        monitor("below", 0, 1080, 1600, 860),
    ];

    assert_eq!(
        select_monitor(&PhysicalRect::new(-2000, 400, 96, 72), &monitors),
        Some(1)
    );
    assert_eq!(
        select_monitor(&PhysicalRect::new(500, -900, 96, 72), &monitors),
        Some(2)
    );
    assert_eq!(
        select_monitor(&PhysicalRect::new(500, 1300, 96, 72), &monitors),
        Some(3)
    );
}

#[test]
fn monitor_selection_prefers_largest_intersection_then_center() {
    let monitors = [
        monitor("a", 0, 0, 1000, 1000),
        monitor("b", 1000, 0, 1000, 1000),
    ];

    assert_eq!(
        select_monitor(&PhysicalRect::new(940, 100, 200, 100), &monitors),
        Some(1)
    );
    assert_eq!(
        select_monitor(&PhysicalRect::new(900, 100, 200, 100), &monitors),
        Some(1)
    );
}

#[test]
fn monitor_selection_uses_nearest_work_area_across_gaps() {
    let monitors = [
        monitor("left", 0, 0, 1000, 1000),
        monitor("right", 1500, 0, 1000, 1000),
    ];

    assert_eq!(
        select_monitor(&PhysicalRect::new(1320, 400, 50, 50), &monitors),
        Some(1)
    );
}

#[test]
fn monitor_selection_tie_break_is_independent_of_enumeration_order() {
    let window = PhysicalRect::new(1075, 1100, 50, 50);
    let first = [
        monitor("z", 0, 0, 1000, 1000),
        monitor("a", 1200, 1200, 1000, 1000),
    ];
    let reversed = [first[1].clone(), first[0].clone()];

    let first_selected = &first[select_monitor(&window, &first).unwrap()];
    let reversed_selected = &reversed[select_monitor(&window, &reversed).unwrap()];
    assert_eq!(first_selected.name, reversed_selected.name);
}

#[test]
fn monitor_selection_ignores_invalid_work_areas() {
    let monitors = [
        monitor("invalid", 0, 0, 0, 1000),
        monitor("valid", 1000, 0, 1000, 1000),
    ];

    assert_eq!(
        select_monitor(&PhysicalRect::new(10, 10, 50, 50), &monitors),
        Some(1)
    );
    assert_eq!(select_monitor(&PhysicalRect::new(0, 0, 1, 1), &[]), None);
}

#[test]
fn saved_monitor_matches_name_before_geometry() {
    let saved = monitor("display-b", 1920, 0, 2560, 1392);
    let monitors = [
        monitor("display-a", 1920, 0, 2560, 1392),
        monitor("DISPLAY-B", 0, 0, 1920, 1040),
    ];

    assert_eq!(match_monitor(&saved, &monitors), Some(1));
}

#[test]
fn disconnected_saved_monitor_does_not_hijack_the_safe_fallback_chain() {
    let saved = monitor("missing", -2560, 0, 2560, 1392);
    let monitors = [
        monitor("primary", 0, 0, 1920, 1040),
        monitor("other", 1920, 0, 2560, 1392),
    ];

    assert_eq!(match_monitor(&saved, &monitors), None);
}

#[test]
fn renamed_saved_monitor_matches_only_when_its_work_area_is_unchanged() {
    let saved = monitor("old-name", -2560, 0, 2560, 1392);
    let monitors = [
        monitor("primary", 0, 0, 1920, 1040),
        monitor("new-name", -2560, 0, 2560, 1392),
    ];

    assert_eq!(match_monitor(&saved, &monitors), Some(1));
}

#[test]
fn duplicate_monitor_names_use_saved_geometry() {
    let saved = monitor("same-model", 1920, 0, 2560, 1392);
    let monitors = [
        monitor("same-model", 0, 0, 1920, 1040),
        monitor("same-model", 1920, 0, 2560, 1392),
    ];

    assert_eq!(match_monitor(&saved, &monitors), Some(1));
}

#[test]
fn issue_55_mixed_dpi_layout_selects_both_drag_directions() {
    let primary_150 = monitor("primary-150", 0, 0, 2880, 1560);
    let secondary_125 = monitor("secondary-125", 2880, 0, 2400, 1300);
    let monitors = [primary_150, secondary_125];

    let on_secondary = PhysicalRect::new(4000, 420, 80, 60);
    let on_primary = PhysicalRect::new(1200, 420, 96, 72);

    assert_eq!(select_monitor(&on_secondary, &monitors), Some(1));
    assert_eq!(select_monitor(&on_primary, &monitors), Some(0));
}

#[test]
fn zero_sized_window_rect_has_a_deterministic_nearest_monitor() {
    let monitors = [
        monitor("left", 0, 0, 1000, 1000),
        monitor("right", 1500, 0, 1000, 1000),
    ];

    assert_eq!(
        select_monitor(&PhysicalRect::new(1400, 400, 0, 0), &monitors),
        Some(1)
    );
}

#[test]
fn resolution_and_dpi_matrix_selects_each_synthetic_target() {
    let resolutions = [
        (1280_u32, 720_u32),
        (1366, 768),
        (1600, 900),
        (1920, 1080),
        (2560, 1440),
        (3840, 2160),
    ];
    let scales = [1.0_f64, 1.25, 1.5, 2.0];
    let mut cases = 0;

    for (width, height) in resolutions {
        for scale in scales {
            let primary = monitor("primary", 0, 0, 1920, 1040);
            let target = monitor("target", 1920, 0, width, height);
            let width = (64.0 * scale).round() as u32;
            let height = (48.0 * scale).round() as u32;
            let rect =
                PhysicalRect::new(1920 + width as i32 - width as i32, 100, width, height);
            let monitors = [primary, target];

            assert_eq!(select_monitor(&rect, &monitors), Some(1));
            cases += 1;
        }
    }

    assert_eq!(cases, 24);
}
