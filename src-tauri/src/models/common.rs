//! 通用泛型 DTO。

use serde::Serialize;

/// 分页结果（IPC-CONTRACT-v2 §5.6）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Paginated<T> {
    pub items: Vec<T>,
    pub total: i64,
    pub page: i64,
    pub limit: i64,
    pub has_more: bool,
}

impl<T> Paginated<T> {
    pub fn new(items: Vec<T>, total: i64, page: i64, limit: i64) -> Self {
        Self {
            items,
            total,
            page,
            limit,
            has_more: page * limit < total,
        }
    }
}

/// 显示器工作区（DIP / 逻辑像素），供前端 auto-fit 当布局上界（IPC-CONTRACT-v2 §3.7）。
///
/// 与窗口位置的 DIP 口径一致（K-6/K-15）：前端 `setSize`/`setPosition` 走 LogicalSize/
/// LogicalPosition，故这里直接给逻辑像素，前端无需再除 `scaleFactor`。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkAreaDip {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

/// 某一扇窗口在屏幕上的矩形（DIP / 逻辑像素）。
///
/// 目前只有 `main_window_rect` 用：便利贴等浮层要「默认落在小条附近」，
/// 而发起建窗的可能是便利贴窗 / 事项窗本身——前端不能拿自己的位置当基准。
/// 走 IPC 而不是前端 `Window.getByLabel`：后者依赖 `allow-get-all-windows`，
/// 本应用的能力白名单没放行，会静默拿不到主窗（历史上「改了但没生效」的根因）。
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowRectDip {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}
