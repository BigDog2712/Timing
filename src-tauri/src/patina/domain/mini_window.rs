//! Physical geometry and interaction policy for the independent mini window.
pub mod content;
pub mod geometry;
pub mod transition;
use geometry::MonitorAffinity;
use serde::{Deserialize, Serialize};

pub use super::window_geometry::{PhysicalPoint as Point, PhysicalRect as Rect};

pub const PANEL_WIDTH: f64 = 320.0;
pub const PANEL_HEIGHT: f64 = 240.0;

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Page {
    #[default]
    Activity,
    Tools,
}

impl Page {
    pub fn cycle(self, _forward: bool) -> Self {
        match self {
            Self::Activity => Self::Tools,
            Self::Tools => Self::Activity,
        }
    }
}

fn read_saved_page<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Page, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(serde_json::from_value(value).unwrap_or_default())
}

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Edge {
    #[default]
    Top,
    Left,
    Right,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct Placement {
    pub monitor: Option<MonitorAffinity>,
    pub edge: Option<Edge>,
    pub last_edge: Edge,
    pub anchor: f64,
    pub floating: Option<Rect>,
}

impl Default for Placement {
    fn default() -> Self {
        Self {
            monitor: None,
            edge: Some(Edge::Top),
            last_edge: Edge::Top,
            anchor: 0.5,
            floating: None,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct Preferences {
    pub placement: Placement,
    pub held: bool,
    #[serde(default, deserialize_with = "read_saved_page")]
    pub page: Page,
}

pub fn scale(value: f64, dpi: f64) -> i32 {
    (value
        * if dpi.is_finite() && dpi > 0.0 {
            dpi
        } else {
            1.0
        })
    .round() as i32
}

pub fn clamp_rect(rect: Rect, work: Rect) -> Rect {
    let width = rect.width.max(1).min(work.width.max(1));
    let height = rect.height.max(1).min(work.height.max(1));
    Rect::new(
        rect.x.clamp(
            work.x,
            work.x
                .saturating_add(work.width.saturating_sub(width) as i32),
        ),
        rect.y.clamp(
            work.y,
            work.y
                .saturating_add(work.height.saturating_sub(height) as i32),
        ),
        width,
        height,
    )
}

pub fn bounds(placement: &Placement, expanded: bool, work: Rect, dpi: f64) -> Rect {
    let (width, height) = if expanded || placement.edge.is_none() {
        (PANEL_WIDTH, PANEL_HEIGHT)
    } else if placement.edge == Some(Edge::Top) {
        (112.0, 24.0)
    } else {
        (24.0, 88.0)
    };
    let width = scale(width, dpi).max(1) as u32;
    let height = scale(height, dpi).max(1) as u32;
    let anchor = if placement.anchor.is_finite() {
        placement.anchor.clamp(0.0, 1.0)
    } else {
        0.5
    };
    let x = work.x + (f64::from(work.width) * anchor).round() as i32 - width as i32 / 2;
    let y = work.y + (f64::from(work.height) * anchor).round() as i32 - height as i32 / 2;
    let rect = match placement.edge {
        Some(Edge::Top) => Rect::new(x, work.y, width, height),
        Some(Edge::Left) => Rect::new(work.x, y, width, height),
        Some(Edge::Right) => Rect::new(work.x + work.width as i32 - width as i32, y, width, height),
        None => {
            let saved = placement.floating.unwrap_or(Rect::new(
                work.x + (work.width as i32 - width as i32) / 2,
                work.y + (work.height as i32 - height as i32) / 2,
                width,
                height,
            ));
            let previous_work = placement
                .monitor
                .as_ref()
                .map(|m| m.work_area)
                .unwrap_or(work);
            let fraction = |position: i32, origin: i32, extent: u32, size: u32| {
                ((f64::from(position) - f64::from(origin))
                    / f64::from(extent.saturating_sub(size).max(1)))
                .clamp(0.0, 1.0)
            };
            Rect::new(
                work.x
                    + (fraction(saved.x, previous_work.x, previous_work.width, saved.width)
                        * f64::from(work.width.saturating_sub(width)))
                    .round() as i32,
                if previous_work == work {
                    saved.y
                } else {
                    work.y
                        + (fraction(saved.y, previous_work.y, previous_work.height, saved.height)
                            * f64::from(work.height.saturating_sub(height)))
                        .round() as i32
                },
                width,
                height,
            )
        }
    };
    clamp_rect(rect, work)
}

pub fn near_handle(handle: Rect, edge: Edge, work: Rect, dpi: f64, point: Point) -> bool {
    if !work.contains_point(point) {
        return false;
    }
    let margin = scale(10.0, dpi);
    let depth = scale(32.0, dpi);
    let region = match edge {
        Edge::Top => Rect::new(
            handle.x - margin,
            work.y,
            handle.width + (margin * 2) as u32,
            depth as u32,
        ),
        Edge::Left => Rect::new(
            work.x,
            handle.y - margin,
            depth as u32,
            handle.height + (margin * 2) as u32,
        ),
        Edge::Right => Rect::new(
            work.x + work.width as i32 - depth,
            handle.y - margin,
            depth as u32,
            handle.height + (margin * 2) as u32,
        ),
    };
    region.contains_point(point)
}

pub fn release_placement(previous: &Placement, rect: Rect, work: Rect, dpi: f64) -> Placement {
    let rect = clamp_rect(rect, work);
    let mut next = previous.clone();
    let distances = [
        (Edge::Top, (i64::from(rect.y) - i64::from(work.y)).abs()),
        (Edge::Left, (i64::from(rect.x) - i64::from(work.x)).abs()),
        (
            Edge::Right,
            (i64::from(rect.x) + i64::from(rect.width) - i64::from(work.x) - i64::from(work.width))
                .abs(),
        ),
    ];
    next.edge = distances
        .into_iter()
        .filter(|(_, distance)| *distance <= i64::from(scale(24.0, dpi)))
        .min_by_key(|(edge, distance)| {
            (*distance, if Some(*edge) == previous.edge { 0 } else { 1 })
        })
        .map(|(edge, _)| edge);
    if let Some(edge) = next.edge {
        next.last_edge = edge;
        next.anchor = match edge {
            Edge::Top => {
                (f64::from(rect.x - work.x) + f64::from(rect.width) / 2.0)
                    / f64::from(work.width.max(1))
            }
            _ => {
                (f64::from(rect.y - work.y) + f64::from(rect.height) / 2.0)
                    / f64::from(work.height.max(1))
            }
        }
        .clamp(0.0, 1.0);
    } else {
        next.floating = Some(rect);
    }
    next
}

/// The caller supplies monotonic time; there are no delayed mutation callbacks.
#[derive(Clone, Default)]
pub struct Interaction {
    pub expanded: bool,
    pub protected: bool,
    pub dragging: bool,
    pub leave_since: Option<std::time::Instant>,
    pub require_leave: bool,
}

impl Interaction {
    pub fn reveal(&mut self) {
        self.expanded = true;
        self.leave_since = None;
    }
    pub fn tick(&mut self, near: bool, automatic: bool, now: std::time::Instant) -> bool {
        let before = self.expanded;
        if !near {
            self.require_leave = false;
        }
        if self.dragging || self.protected || !automatic {
            self.leave_since = None;
        } else if near {
            self.leave_since = None;
            if !self.require_leave {
                self.expanded = true;
            }
        } else if self.expanded {
            let since = self.leave_since.get_or_insert(now);
            if now.saturating_duration_since(*since) >= std::time::Duration::from_millis(450) {
                self.expanded = false;
                self.leave_since = None;
            }
        }
        before != self.expanded
    }
}

#[cfg(test)]
#[path = "mini_window_mod_tests.rs"]
mod tests;
