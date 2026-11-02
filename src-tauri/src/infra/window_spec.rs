//! 多窗口规格（纯函数）：`label → 窗口配置` 映射（ADR-009 / ARCHITECTURE-V0.2.0 §6.a）。
//!
//! 纯数据、无 Tauri 依赖，便于单测。尺寸均为**逻辑像素**，与 `tauri.conf.json`（主窗）及
//! ADR-009 窗口目录一致；实际几何仍由 `infra::window::reclamp` 按多屏工作区钳制（K-6/K-15）。

/// 一类窗口的规格。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct WindowSpec {
    /// 窗口 label（同时也是 `window-state` 的持久化键）。
    pub label: &'static str,
    /// 页面 URL（含 `?w=` 路由参数；`App.tsx` 亦按 label 路由）。
    pub url: &'static str,
    pub title: &'static str,
    pub width: f64,
    pub height: f64,
    pub min_width: f64,
    pub min_height: f64,
    /// 最大尺寸。**固定尺寸窗取 min == max == 尺寸**：`window-state` 以**物理像素**回填
    /// 尺寸，跨 DPI 显示器（如 150% → 100%）会漂移；钉死上下限由窗口管理器夹回正确逻辑尺寸
    /// （K-15；与主窗 `tauri.conf.json` 的 minWidth==maxWidth 同法）。
    pub max_width: f64,
    pub max_height: f64,
    pub resizable: bool,
    /// 无系统标题栏（页面内自绘标题栏 + `data-tauri-drag-region`，与主窗一致）。
    pub decorations: bool,
    /// 透明底（配合圆角自绘外壳；亦使「早显」为不可见，防白闪，K-18）。
    pub transparent: bool,
    pub skip_taskbar: bool,
    /// 是否置顶。**[V0.3.3] 起所有窗口恒为 true**——「保持窗口置顶」设置项已删除，
    /// 不再可切换（ADR-022）；主窗 `main` 由 `tauri.conf.json` 的 `alwaysOnTop: true` 承担。
    /// 便利贴窗口的**运行期**置顶仍按 `notes.is_pinned` 逐窗切换（独立特性，AC-64）。
    pub always_on_top: bool,
}

/// 设置面板（单例；392×660，不可缩放，恒定置顶；ADR-009 §窗口目录 / settings-panel.md §1）。
///
/// V0.1.0 主窗 `main` 仍由 `tauri.conf.json` 声明，不在此表（避免重复来源）。
pub const SETTINGS: WindowSpec = WindowSpec {
    label: "settings",
    url: "index.html?w=settings",
    title: "TickBar 设置",
    width: 392.0,
    height: 660.0,
    min_width: 392.0,
    min_height: 660.0,
    max_width: 392.0,
    max_height: 660.0,
    resizable: false,
    decorations: false,
    transparent: true,
    /* [V0.2.8] 设置面板也是浮层，不上任务栏（用户要求「唤起的悬浮菜单不该出现在任务栏」） */
    skip_taskbar: true,
    /* [V0.3.3] 恒定置顶：设置项已删除，不再可切换（ADR-022） */
    always_on_top: true,
};

/// 事项窗口（单例）。面板宽 252（V0.3.9 从 336 缩 1/4），窗口另含左侧 240 透明预览区；
/// 高自适应，区间 [360, 560]（禁止手动缩放）。
///
/// 取值依据：ADR-009 窗口目录 / ARCHITECTURE-V0.2.0 §6.a 登记「宽 336（高自适应，min 360）」
/// —— min_height 取登记值 360；max_height 取设计稿 `todos-panel.md §1`「最大 ≈560」，默认高
/// 取 min（内容驱动，超出滚动）。窗口所有尺寸都由应用布局决定，用户不可手动调整宽高。
/// [V0.3.9] 宽度按用户口径缩到原来的 3/4：336 → 252（「事项组件右键唤出的菜单宽度缩小四分之一」）。
/// 只读计时器窗口（单例）。
pub const TIMER: WindowSpec = WindowSpec {
    label: "timer",
    url: "index.html?w=timer",
    title: "TickBar 计时器",
    width: 280.0,
    height: 180.0,
    min_width: 280.0,
    min_height: 180.0,
    max_width: 280.0,
    max_height: 180.0,
    resizable: false,
    decorations: false,
    transparent: true,
    skip_taskbar: true,
    always_on_top: true,
};

/// 事项窗**面板**宽度（逻辑像素）。窗口本身比它宽，见 [`TODOS_PREVIEW_INSET`]。
pub const TODOS_PANEL_W: f64 = 252.0;

/// 事项窗左侧的**透明预览区**宽度（V0.3.9）。
///
/// 用户口径：「事项菜单里悬停在事项上，若该事项有便利贴，应在事项左侧预览便利贴」。
/// WebView 只能画在窗口内，所以窗口整体向左加宽这段，面板靠右贴住主条原位，
/// 左边这段透明区在悬停时承载便利贴预览卡（不悬停时完全透明、看不见）。
pub const TODOS_PREVIEW_INSET: f64 = 240.0;

pub const TODOS: WindowSpec = WindowSpec {
    label: "todos",
    url: "index.html?w=todos",
    title: "TickBar 事项",
    /* [V0.3.9] 面板 252 + 左侧预览区 240 = 492。面板仍只占 252，右侧对齐主条左边缘；
    多出来的 240 是透明区，见 TODOS_PREVIEW_INSET。 */
    width: TODOS_PANEL_W + TODOS_PREVIEW_INSET,
    height: 360.0,
    min_width: TODOS_PANEL_W + TODOS_PREVIEW_INSET,
    min_height: 360.0,
    max_width: TODOS_PANEL_W + TODOS_PREVIEW_INSET,
    max_height: 560.0,
    resizable: false,
    decorations: false,
    transparent: true,
    /* [V0.2.8] 事项窗同样是浮层：不上任务栏，且指针离开即隐藏（见前端 useWindowLeaveHide） */
    skip_taskbar: true,
    /* [V0.3.3] 恒定置顶：设置项已删除，不再可切换（ADR-022） */
    always_on_top: true,
};

/// 便利贴窗口（动态 label `note-{id}`；ADR-009 / sticky-note.md）。
///
/// 尺寸可缩放：默认 320×232，硬钳制 min 160×120 / max 900×900（运行时再受 `work_area` 收窄）。
/// `always_on_top:true` —— 便利贴为桌面配件，默认态须置顶（AC-64）。
///
/// 注：`label` 字段为**模板前缀基名**（`"note"`），实际 label 由 `note_label(id)` 生成；
/// 几何由 DB `notes` 行在打开时传入（不取此默认值，此值仅作说明 / 上限兜底参考）。
pub const NOTE: WindowSpec = WindowSpec {
    label: "note",
    url: "index.html?w=note",
    title: "TickBar 便利贴",
    width: 320.0,
    height: 232.0,
    min_width: 160.0,
    min_height: 120.0,
    max_width: 900.0,
    max_height: 900.0,
    resizable: true,
    decorations: false,
    transparent: true,
    skip_taskbar: true,
    always_on_top: true,
};

/// 便利贴窗口 label 前缀。
pub const NOTE_LABEL_PREFIX: &str = "note-";

/// 便利贴窗口 label（`note-{id}`）。
pub fn note_label(id: i64) -> String {
    format!("{NOTE_LABEL_PREFIX}{id}")
}

/// 按 label 查规格；未登记返回 `None`。
///
/// `note-{id}` 动态 label 统一返回 `NOTE`（几何另由 DB 行提供）。
pub fn spec_for(label: &str) -> Option<&'static WindowSpec> {
    match label {
        "settings" => Some(&SETTINGS),
        "timer" => Some(&TIMER),
        "todos" => Some(&TODOS),
        _ if label.starts_with(NOTE_LABEL_PREFIX) => Some(&NOTE),
        _ => None,
    }
}
