use crate::models::insight::window_geometry::{PhysicalPoint, PhysicalRect};
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct MonitorAffinity {
    pub name: Option<String>,
    pub work_area: PhysicalRect,
}

impl MonitorAffinity {
    pub fn new(name: Option<String>, work_area: PhysicalRect) -> Self {
        Self {
            name: normalize_monitor_name(name),
            work_area,
        }
    }

    fn stable_key(&self) -> (String, i32, i32, u32, u32) {
        (
            self.name
                .as_deref()
                .unwrap_or_default()
                .trim()
                .to_ascii_lowercase(),
            self.work_area.x,
            self.work_area.y,
            self.work_area.width,
            self.work_area.height,
        )
    }
}

fn normalize_monitor_name(name: Option<String>) -> Option<String> {
    name.and_then(|name| {
        let trimmed = name.trim();
        (!trimmed.is_empty()).then(|| trimmed.to_string())
    })
}

pub fn select_monitor_for_release(
    release_point: PhysicalPoint,
    monitors: &[MonitorAffinity],
) -> Option<usize> {
    select_monitor(
        &PhysicalRect::new(release_point.x, release_point.y, 1, 1),
        monitors,
    )
}

pub fn select_monitor(window_rect: &PhysicalRect, monitors: &[MonitorAffinity]) -> Option<usize> {
    let mut best: Option<(usize, MonitorScore)> = None;

    for (index, monitor) in monitors.iter().enumerate() {
        if !monitor.work_area.is_valid() {
            continue;
        }

        let score = MonitorScore {
            intersection_area: intersection_area(*window_rect, monitor.work_area),
            contains_center: contains_center(monitor.work_area, *window_rect),
            distance_squared: point_to_rect_distance_squared(
                window_rect.center(),
                monitor.work_area,
            ),
            stable_key: monitor.stable_key(),
        };

        let should_replace = best
            .as_ref()
            .map(|(_, current)| score.is_better_than(current))
            .unwrap_or(true);
        if should_replace {
            best = Some((index, score));
        }
    }

    best.map(|(index, _)| index)
}

pub fn match_monitor(saved: &MonitorAffinity, monitors: &[MonitorAffinity]) -> Option<usize> {
    let valid_monitors = monitors
        .iter()
        .enumerate()
        .filter(|(_, monitor)| monitor.work_area.is_valid());

    if let Some(saved_name) = saved.name.as_deref() {
        let mut exact_matches = valid_monitors
            .clone()
            .filter(|(_, monitor)| {
                monitor
                    .name
                    .as_deref()
                    .is_some_and(|name| name.eq_ignore_ascii_case(saved_name))
            })
            .collect::<Vec<_>>();
        exact_matches.sort_by(|(_, left), (_, right)| compare_affinity_match(saved, left, right));
        if let Some((index, _)) = exact_matches.first() {
            return Some(*index);
        }
    }

    let mut exact_geometry_matches = valid_monitors
        .filter(|(_, monitor)| monitor.work_area == saved.work_area)
        .collect::<Vec<_>>();
    exact_geometry_matches
        .sort_by(|(_, left), (_, right)| left.stable_key().cmp(&right.stable_key()));
    exact_geometry_matches.first().map(|(index, _)| *index)
}

#[derive(Debug)]
struct MonitorScore {
    intersection_area: u64,
    contains_center: bool,
    distance_squared: f64,
    stable_key: (String, i32, i32, u32, u32),
}

impl MonitorScore {
    fn is_better_than(&self, other: &Self) -> bool {
        match self.intersection_area.cmp(&other.intersection_area) {
            Ordering::Greater => return true,
            Ordering::Less => return false,
            Ordering::Equal => {}
        }

        match self.contains_center.cmp(&other.contains_center) {
            Ordering::Greater => return true,
            Ordering::Less => return false,
            Ordering::Equal => {}
        }

        if self.intersection_area == 0 {
            match self.distance_squared.total_cmp(&other.distance_squared) {
                Ordering::Less => return true,
                Ordering::Greater => return false,
                Ordering::Equal => {}
            }
        }

        self.stable_key < other.stable_key
    }
}

fn intersection_area(left: PhysicalRect, right: PhysicalRect) -> u64 {
    let overlap_width =
        (left.right().min(right.right()) - i64::from(left.x).max(i64::from(right.x))).max(0);
    let overlap_height =
        (left.bottom().min(right.bottom()) - i64::from(left.y).max(i64::from(right.y))).max(0);

    u64::try_from(overlap_width).unwrap_or(0) * u64::try_from(overlap_height).unwrap_or(0)
}

fn contains_center(container: PhysicalRect, target: PhysicalRect) -> bool {
    let (center_x, center_y) = target.center();
    center_x >= f64::from(container.x)
        && center_x < container.right() as f64
        && center_y >= f64::from(container.y)
        && center_y < container.bottom() as f64
}

fn point_to_rect_distance_squared((point_x, point_y): (f64, f64), rect: PhysicalRect) -> f64 {
    let left = f64::from(rect.x);
    let right = rect.right() as f64;
    let top = f64::from(rect.y);
    let bottom = rect.bottom() as f64;
    let delta_x = if point_x < left {
        left - point_x
    } else if point_x > right {
        point_x - right
    } else {
        0.0
    };
    let delta_y = if point_y < top {
        top - point_y
    } else if point_y > bottom {
        point_y - bottom
    } else {
        0.0
    };

    delta_x.mul_add(delta_x, delta_y * delta_y)
}

fn compare_affinity_match(
    saved: &MonitorAffinity,
    left: &MonitorAffinity,
    right: &MonitorAffinity,
) -> Ordering {
    affinity_geometry_distance(saved.work_area, left.work_area)
        .cmp(&affinity_geometry_distance(
            saved.work_area,
            right.work_area,
        ))
        .then_with(|| left.stable_key().cmp(&right.stable_key()))
}

fn affinity_geometry_distance(saved: PhysicalRect, candidate: PhysicalRect) -> u64 {
    i64::from(saved.x)
        .abs_diff(i64::from(candidate.x))
        .saturating_add(i64::from(saved.y).abs_diff(i64::from(candidate.y)))
        .saturating_add(u64::from(saved.width.abs_diff(candidate.width)))
        .saturating_add(u64::from(saved.height.abs_diff(candidate.height)))
}

#[cfg(test)]
#[path = "geometry_mod_tests.rs"]
mod tests;
