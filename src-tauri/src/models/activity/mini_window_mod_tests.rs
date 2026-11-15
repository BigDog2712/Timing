//! `mini_window.rs` 的测试（从原文件抽出，仅为守住单文件 ≤300 行）。
//!
//! `mod tests` 仍声明在原模块内（`#[path]` 指向本文件），`super::` 语义不变。

use super::*;
#[test]
fn geometry_stays_inside_negative_monitors_at_all_supported_scales() {
    let work = Rect::new(-2560, -200, 2560, 1400);
    for dpi in [1.0, 1.25, 1.5, 2.0] {
        for edge in [Some(Edge::Top), Some(Edge::Left), Some(Edge::Right), None] {
            for expanded in [false, true] {
                let placement = Placement {
                    edge,
                    anchor: 1.0,
                    ..Placement::default()
                };
                let rect = bounds(&placement, expanded, work, dpi);
                assert!(work.contains_point(Point::new(rect.x, rect.y)));
                assert!(work.contains_point(Point::new(
                    rect.x + rect.width as i32 - 1,
                    rect.y + rect.height as i32 - 1
                )));
            }
        }
    }
}
#[test]
fn snap_uses_dpi_and_nearest_edge_with_previous_edge_tie_break() {
    let work = Rect::new(0, 0, 1920, 1040);
    let previous = Placement {
        edge: Some(Edge::Left),
        ..Placement::default()
    };
    assert_eq!(
        release_placement(&previous, Rect::new(30, 30, 456, 360), work, 1.5).edge,
        Some(Edge::Left)
    );
    assert_eq!(
        release_placement(&previous, Rect::new(30, 30, 304, 240), work, 1.0).edge,
        None
    );
    assert_eq!(
        release_placement(&previous, Rect::new(400, 800, 304, 240), work, 1.0).edge,
        None
    );
}
#[test]
fn releasing_past_a_work_area_edge_still_docks_on_that_edge() {
    for work in [
        Rect::new(0, 0, 1920, 1040),
        Rect::new(-2560, -200, 2560, 1400),
    ] {
        for dpi in [1.0, 1.25, 1.5, 2.0] {
            let width = scale(PANEL_WIDTH, dpi) as u32;
            let height = scale(240.0, dpi) as u32;
            let overshoot = scale(100.0, dpi);
            for (edge, rect) in [
                (
                    Edge::Left,
                    Rect::new(work.x - overshoot, work.y + 300, width, height),
                ),
                (
                    Edge::Right,
                    Rect::new(
                        work.x + work.width as i32 - width as i32 + overshoot,
                        work.y + 300,
                        width,
                        height,
                    ),
                ),
                (
                    Edge::Top,
                    Rect::new(work.x + 500, work.y - overshoot, width, height),
                ),
            ] {
                let released = release_placement(&Placement::default(), rect, work, dpi);
                assert_eq!(
                    released.edge,
                    Some(edge),
                    "{edge:?} at {dpi} DPI in {work:?}"
                );
                assert_eq!(released.last_edge, edge);
                let panel = bounds(&released, true, work, dpi);
                assert!(work.contains_point(Point::new(panel.x, panel.y)));
                assert!(work.contains_point(Point::new(
                    panel.x + panel.width as i32 - 1,
                    panel.y + panel.height as i32 - 1
                )));
            }
        }
    }
}
#[test]
fn hot_region_is_local_and_cannot_reach_the_next_monitor() {
    let work = Rect::new(-1920, 0, 1920, 1040);
    let handle = bounds(&Placement::default(), false, work, 1.0);
    assert!(near_handle(
        handle,
        Edge::Top,
        work,
        1.0,
        Point::new(-960, 30)
    ));
    assert!(!near_handle(
        handle,
        Edge::Top,
        work,
        1.0,
        Point::new(-1500, 0)
    ));
    assert!(!near_handle(
        handle,
        Edge::Top,
        work,
        1.0,
        Point::new(-960, -1)
    ));
}
#[test]
fn floating_position_preserves_its_fraction_after_monitor_or_dpi_changes() {
    let old = Rect::new(-1920, 0, 1920, 1040);
    let placement = Placement {
        edge: None,
        monitor: Some(MonitorAffinity::new(None, old)),
        floating: Some(Rect::new(-1112, 400, 304, 240)),
        ..Placement::default()
    };
    assert_eq!(
        bounds(&placement, true, Rect::new(0, -1440, 2560, 1400), 1.5),
        Rect::new(1040, -920, 480, 360)
    );
}
#[test]
fn page_migration_preserves_placement_and_hold_and_cycles_both_directions() {
    for page in ["null", "7", "\"future\"", "\"today\""] {
        let preferences: Preferences = serde_json::from_str(&format!(
            "{{\"held\":true,\"placement\":{{\"edge\":\"left\",\"anchor\":0.25}},\"page\":{page}}}"
        )).unwrap();
        assert!(preferences.held);
        assert_eq!(preferences.placement.edge, Some(Edge::Left));
        assert_eq!(preferences.placement.anchor, 0.25);
        assert_eq!(preferences.page, Page::Activity);
    }
    let old: Preferences = serde_json::from_str("{\"held\":true}").unwrap();
    assert_eq!(old.page, Page::Activity);
    assert_eq!(Page::Activity.cycle(true), Page::Tools);
    assert_eq!(Page::Tools.cycle(true), Page::Activity);
    for page in [Page::Activity, Page::Tools] {
        assert_eq!(page.cycle(false).cycle(true), page);
    }
}
#[test]
fn damaged_saved_floating_rect_cannot_overflow_the_available_work_area() {
    let work = Rect::new(1920, 0, 2560, 1400);
    let placement = Placement {
        edge: None,
        monitor: Some(MonitorAffinity::new(None, Rect::new(i32::MIN, 0, 1, 1))),
        floating: Some(Rect::new(i32::MAX, i32::MIN, u32::MAX, u32::MAX)),
        ..Placement::default()
    };
    let rect = bounds(&placement, true, work, 1.0);
    assert_eq!(rect, Rect::new(4160, 0, 320, 240));
}
#[test]
fn leave_delay_reentry_and_protection_cancel_collapse() {
    let now = std::time::Instant::now();
    let mut state = Interaction::default();
    assert!(state.tick(true, true, now));
    assert!(!state.tick(false, true, now));
    assert!(!state.tick(false, true, now + std::time::Duration::from_millis(449)));
    state.protected = true;
    assert!(!state.tick(false, true, now + std::time::Duration::from_millis(500)));
    state.protected = false;
    assert!(!state.tick(false, true, now + std::time::Duration::from_millis(600)));
    assert!(state.tick(false, true, now + std::time::Duration::from_millis(1050)));
    state.require_leave = true;
    assert!(!state.tick(true, true, now));
    state.tick(false, true, now);
    assert!(state.tick(true, true, now));
    assert!(!state.tick(false, false, now + std::time::Duration::from_secs(2)));
}
