//! 托盘菜单构造（**纯函数**）——ADR-013「保留原生菜单 + 按状态裁剪（方案 Ⅰ）」。
//!
//! 与 Tauri 解耦：状态文本、名称截断、菜单结构均可在单测中直接断言。
//! 文案口径与 `MenuStatusBlock` 一致；**纯文本、无圆点 / 无 emoji**（P0 从紧）。
//!
//! 范围说明：本模块只登记**后端已具备能力**的菜单项。设计稿
//! `docs/design/pages-V0.2.0/tray-menu.md §1.1` 中依赖尚未交付能力的项（日期视图 / 日记 /
//! 关于面板等）不生成（**不产出空占位项**）。批 2 已追加「打开事项 / 编辑固定任务… /
//! 便利贴…」三个后端已具备能力的项（后两者 emit 应用内事件交由前端弹菜单）。

use crate::models::enums::TrayStatus;

/// 状态项 / 标签里任务名的显示宽上限（K-30）。原生菜单按最宽项撑大整菜单、不自动省略。
pub const LABEL_MAX_CHARS: usize = 20;

/* 菜单项 id（稳定；`on_menu_event` 按此分发） */
pub const ID_STATUS: &str = "status";
pub const ID_TIMER_START: &str = "timer_start";
pub const ID_TIMER_PAUSE: &str = "timer_pause";
pub const ID_TIMER_RESUME: &str = "timer_resume";
pub const ID_TIMER_STOP: &str = "timer_stop";
pub const ID_TIMER_DISCARD: &str = "timer_discard";
pub const ID_SHOW_HIDE: &str = "show_hide";
pub const ID_NEW_ITEM: &str = "new_item";
pub const ID_OPEN_SETTINGS: &str = "open_settings";
/* [V0.2.0 批 2] 后端已具备能力的常显项 */
pub const ID_OPEN_TODOS: &str = "open_todos";
pub const ID_OPEN_COMMON_ITEMS: &str = "open_common_items";
pub const ID_OPEN_NOTE: &str = "open_note";
pub const ID_QUIT: &str = "quit";

/// 时长显示上限（与前端 `formatDuration` 同口径：99:59:59）。
const MAX_DISPLAY_SEC: i64 = 99 * 3600 + 59 * 60 + 59;

/// 一条菜单节点：分隔线，或文本项。
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TrayNode {
    Separator,
    Item {
        id: &'static str,
        label: String,
        enabled: bool,
    },
}

impl TrayNode {
    fn item(id: &'static str, label: impl Into<String>, enabled: bool) -> Self {
        TrayNode::Item {
            id,
            label: label.into(),
            enabled,
        }
    }
}

/// 顶部状态项文案（**禁用**文本项，与 `MenuStatusBlock` 同口径；设计稿 §3.3.1）。
///
/// - 空闲：`空闲 · 点开始正计时`
/// - 计时中：`任务名 · 12:34`
/// - 暂停中：`任务名 · 已暂停 · 12:34`
///
/// 倒计时态（`任务名 · 倒计时 剩 MM:SS`）由 `countdown_status_line` 单独承载。
pub fn status_line(status: TrayStatus, item_name: &str, duration_sec: i64) -> String {
    match status {
        TrayStatus::Idle => "空闲 · 点开始正计时".to_string(),
        TrayStatus::Running | TrayStatus::Countdown => {
            format!(
                "{} · {}",
                display_name(item_name),
                format_duration(duration_sec)
            )
        }
        TrayStatus::Paused => format!(
            "{} · 已暂停 · {}",
            display_name(item_name),
            format_duration(duration_sec)
        ),
    }
}

/// 构造托盘菜单节点（纯函数）。**内容仅在状态迁移时重建**（K-30：禁止每 tick 重建）。
///
/// 结构：状态组 ─ 控制组（按状态裁剪） ─ 常用组 ─ 退出。
/// 控制组**不生成不可用项**（方案 Ⅰ：裁剪，而非灰置）。
pub fn build_nodes(status: TrayStatus, line: &str) -> Vec<TrayNode> {
    let mut nodes = vec![TrayNode::item(ID_STATUS, line, false), TrayNode::Separator];

    match status {
        TrayStatus::Idle => nodes.push(TrayNode::item(ID_TIMER_START, "开始正计时", true)),
        TrayStatus::Running | TrayStatus::Countdown => {
            nodes.push(TrayNode::item(ID_TIMER_PAUSE, "暂停", true))
        }
        TrayStatus::Paused => nodes.push(TrayNode::item(ID_TIMER_RESUME, "继续", true)),
    }
    // 计时中 / 倒计时中 / 暂停中共有的收尾项（设计稿 §1.1 项 3/4）
    if status != TrayStatus::Idle {
        nodes.push(TrayNode::item(ID_TIMER_STOP, "结束并写入事项计时", true));
        nodes.push(TrayNode::item(ID_TIMER_DISCARD, "放弃（不记录）", true));
    }

    nodes.push(TrayNode::Separator);
    nodes.push(TrayNode::item(ID_SHOW_HIDE, "显示 / 隐藏", true));
    nodes.push(TrayNode::item(ID_NEW_ITEM, "新建事项", true));
    nodes.push(TrayNode::item(ID_OPEN_TODOS, "打开事项", true));
    nodes.push(TrayNode::item(ID_OPEN_COMMON_ITEMS, "编辑固定任务…", true));
    nodes.push(TrayNode::item(ID_OPEN_NOTE, "便利贴…", true));
    nodes.push(TrayNode::item(ID_OPEN_SETTINGS, "设置…", true));
    nodes.push(TrayNode::Separator);
    nodes.push(TrayNode::item(ID_QUIT, "退出", true));
    nodes
}

/// 倒计时态的状态行文案（`{事项名} · 倒计时 剩 {MM:SS}`；无事项名 → `倒计时 · 剩 {MM:SS}`）。
///
/// 设计稿 `tray-menu.md §3.3.1`；纯文本、无字符符号（P0）。
pub fn countdown_status_line(item_name: &str, remaining_sec: i64) -> String {
    let duration = format_duration(remaining_sec.max(0));
    let name = display_name(item_name);
    if item_name.trim().is_empty() {
        format!("倒计时 · 剩 {duration}")
    } else {
        format!("{name} · 倒计时 剩 {duration}")
    }
}

/// 事项名截断（设计稿 §3.3.3 / K-30：保留开头，超长尾部加单个 `…`；禁用 `...`）。
pub fn truncate_name(name: &str, max_chars: usize) -> String {
    let trimmed = name.trim();
    if trimmed.chars().count() <= max_chars {
        return trimmed.to_string();
    }
    let head: String = trimmed.chars().take(max_chars).collect();
    format!("{head}…")
}

/// 时长格式化：`<1h` → `MM:SS`；`>=1h` → `HH:MM:SS`；负值归零、上限 99:59:59。
pub fn format_duration(total_sec: i64) -> String {
    let sec = total_sec.clamp(0, MAX_DISPLAY_SEC);
    let hours = sec / 3600;
    let minutes = (sec % 3600) / 60;
    let seconds = sec % 60;
    if hours > 0 {
        format!("{hours:02}:{minutes:02}:{seconds:02}")
    } else {
        format!("{minutes:02}:{seconds:02}")
    }
}

/// 状态项里的名称：截断；空名回落「未命名」（设计稿 §3.3.1）。
fn display_name(item_name: &str) -> String {
    let truncated = truncate_name(item_name, LABEL_MAX_CHARS);
    if truncated.is_empty() {
        "未命名".to_string()
    } else {
        truncated
    }
}
