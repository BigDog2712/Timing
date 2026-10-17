//! 窗口几何纯函数：多显示器工作区钳制（AC-23 / K-6 / K-15）。
//!
//! **像素口径**：本模块一律以**物理像素**运算 —— 窗口 `outer_position`/`outer_size`
//! 与 `Monitor::work_area()` 都是物理像素，二者可直接比较，无需 `scale_factor` 换算
//! （逻辑像素仅用于持久化，见 K-6/K-15）。
//!
//! 纯函数、无副作用、不依赖 Tauri，便于单测（见 `src/tests/geometry.rs`）。

/// 物理像素矩形（左上角坐标 + 宽高）。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

impl Rect {
    pub const fn new(x: i32, y: i32, width: u32, height: u32) -> Self {
        Self {
            x,
            y,
            width,
            height,
        }
    }

    /// 右边界（不含），i64 计算以防越界溢出。
    fn right(&self) -> i64 {
        self.x as i64 + self.width as i64
    }

    /// 下边界（不含），i64 计算以防越界溢出。
    fn bottom(&self) -> i64 {
        self.y as i64 + self.height as i64
    }
}

/// 单个可用显示器的工作区（物理像素），`primary` 标记主屏。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct WorkArea {
    pub rect: Rect,
    pub primary: bool,
}

/// 两矩形是否有**正面积**交集（仅边缘相切不算交集）。
fn intersects(a: &Rect, b: &Rect) -> bool {
    (a.x as i64) < b.right()
        && a.right() > (b.x as i64)
        && (a.y as i64) < b.bottom()
        && a.bottom() > (b.y as i64)
}

/// 把越界窗口钳制回可见区。
///
/// 判定规则：
/// 1. 若 `rect` 与**任一**工作区有交集 → 原样返回；
/// 2. 否则选取目标工作区（**主屏优先**；主屏缺失时取列表首个；列表为空时无法定位，
///    原样返回），把窗口置于该工作区**中心**，必要时收缩到工作区尺寸以内，
///    使矩形**完整落入**工作区。
pub fn clamp_to_workarea(rect: Rect, monitors: &[WorkArea]) -> Rect {
    if monitors.iter().any(|m| intersects(&rect, &m.rect)) {
        return rect;
    }

    let Some(target) = monitors
        .iter()
        .find(|m| m.primary)
        .or_else(|| monitors.first())
    else {
        return rect;
    };
    let area = target.rect;

    // 大于工作区时先收缩（收缩后必然可完整容纳）。
    let width = rect.width.min(area.width);
    let height = rect.height.min(area.height);

    // 居中：偏移量非负，居中即保证矩形完整落在工作区内。
    let x = area.x as i64 + (area.width as i64 - width as i64) / 2;
    let y = area.y as i64 + (area.height as i64 - height as i64) / 2;

    Rect {
        x: x as i32,
        y: y as i32,
        width,
        height,
    }
}
