//! 主窗几何查询（DIP）：工作区上界 + 主条矩形。
//!
//! 从 `infra::window` 拆出（单文件 ≤300 行，ADR-017）：这两条都是**只读**查询，
//! 与建窗/钳制/显隐那套写操作无关，且都只服务前端布局（auto-fit 与浮层落点）。
//!
//! 口径统一为**逻辑像素**（物理像素 / `scale_factor`），与前端 `setSize` /
//! `setPosition` 的 LogicalSize/LogicalPosition 一致（K-6/K-15）。

use tauri::{AppHandle, Manager};

use crate::error::{AppError, AppResult};
use crate::infra::geometry::{overlap_area, Rect};
use crate::infra::window::window_rect;
use crate::models::common::{WindowRectDip, WorkAreaDip};

const MAIN_WINDOW: &str = "main";

/// 主窗所在显示器的工作区（DIP），供前端 auto-fit 当布局上界（ADR-020）。
///
/// 归属判定与 `reclamp` 同源：主窗矩形与各工作区比交叠面积，取最大者；与任何工作区
/// 都不相交时回落主屏。
pub fn main_work_area_dip(app: &AppHandle) -> AppResult<WorkAreaDip> {
    let window = window_rect(app, MAIN_WINDOW)?;
    let monitors = app.available_monitors().map_err(AppError::io)?;

    let mut best: Option<(u64, Rect, f64)> = None;
    for monitor in &monitors {
        let wa = monitor.work_area();
        let area = Rect::new(wa.position.x, wa.position.y, wa.size.width, wa.size.height);
        let hit = overlap_area(&window, &area);
        let better = match best {
            Some((current, _, _)) => hit > current,
            None => true,
        };
        if hit > 0 && better {
            best = Some((hit, area, monitor.scale_factor()));
        }
    }

    let (area, scale) = match best {
        Some((_, area, scale)) => (area, scale),
        None => {
            let primary = app
                .primary_monitor()
                .map_err(AppError::io)?
                .ok_or_else(|| AppError::io("no monitor available"))?;
            let wa = primary.work_area();
            (
                Rect::new(wa.position.x, wa.position.y, wa.size.width, wa.size.height),
                primary.scale_factor(),
            )
        }
    };

    // scale_factor 理论上恒 > 0；防御 0 避免除零把上界放大成 inf。
    let scale = if scale > 0.0 { scale } else { 1.0 };
    Ok(WorkAreaDip {
        x: f64::from(area.x) / scale,
        y: f64::from(area.y) / scale,
        w: f64::from(area.width) / scale,
        h: f64::from(area.height) / scale,
    })
}

/// 主窗（小条）在屏幕上的矩形（DIP），供「便利贴默认落在小条附近」使用。
///
/// 前端在**任意窗口**里都能调（便利贴窗里点「新建便利贴」也拿得到小条的真实位置），
/// 不依赖前端 `Window.getByLabel`——那条路要 `allow-get-all-windows` 权限，白名单里没有。
pub fn main_window_rect_dip(app: &AppHandle) -> AppResult<WindowRectDip> {
    let rect = window_rect(app, MAIN_WINDOW)?;
    let scale = app
        .get_webview_window(MAIN_WINDOW)
        .ok_or_else(|| AppError::io("主窗不存在"))?
        .scale_factor()
        .map_err(AppError::io)?;
    let scale = if scale > 0.0 { scale } else { 1.0 };
    Ok(WindowRectDip {
        x: f64::from(rect.x) / scale,
        y: f64::from(rect.y) / scale,
        w: f64::from(rect.width) / scale,
        h: f64::from(rect.height) / scale,
    })
}
