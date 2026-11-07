//! 托盘菜单构造（**纯函数**）——ADR-013「保留原生菜单 + 按状态裁剪（方案 Ⅰ）」。
//!
//! 与 Tauri 解耦：状态文本、名称截断、菜单结构均可在单测中直接断言。
//! 文案口径与 `MenuStatusBlock` 一致；**纯文本、无圆点 / 无 emoji**（P0 从紧）。
//!
//! 范围说明：本模块只登记**后端已具备能力**的菜单项。设计稿
//! `docs/design/pages-V0.2.0/tray-menu.md §1.1` 中依赖尚未交付能力的项（日期视图 /
//! 关于面板等）不生成（**不产出空占位项**）。批 2 已追加「打开事项 / 编辑固定任务… /
//! 便利贴…」三个后端已具备能力的项（后两者 emit 应用内事件交由前端弹菜单）。
//! [V0.11.7] 追加「Markdown 同步」：一次点击跑一轮双向同步，结果走系统通知。

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
pub const ID_NEW_ITEM: &str = "new_item";
pub const ID_OPEN_SETTINGS: &str = "open_settings";
/* [V0.2.0 批 2] 后端已具备能力的常显项 */
pub const ID_OPEN_TODOS: &str = "open_todos";
pub const ID_OPEN_NOTE: &str = "open_note";
/* [V0.11.7] 一次双向 Markdown 同步（用户口径：不想为了一次同步专门开设置页） */
pub const ID_MD_SYNC: &str = "md_sync";
pub const ID_QUIT: &str = "quit";

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
///
/// [V0.11.18] `sync_label` 由**装配层**算好传进来（`app::tray_sync::sync_label`）。
/// 本模块不许读库：`infra` 不能依赖 `services`（R5，`npm run check:layers` 会拦），
/// 也不许自己判通道——「生效通道」的判据只允许有一份，就在 `md_cloud::usable`。
/// **菜单项的数量与 id 不因标签变而变**：通道切换只换那一项的文字，否则菜单结构会跳。
///
/// [V0.11.18] `quitting` = 「退出前那一轮同步正在跑」（PRD B7 / §13.3.1「等待反馈」）。
/// 为真时**只有退出项**变：标签逐字 `正在同步…`、`enabled: false`；其余项一个字不动。
/// 反馈放在这里而不是发系统通知：用户的手指还停在「退出」那一格，那是他能看到的最省注意力
/// 的位置，而退出途中弹的通知他既看得到也点不到（通知本身可能被专注助手拦掉）。
/// **不需要复位**：置真之后进程马上要退出，没有第二条路径会再读这个值。
pub fn build_nodes(
    status: TrayStatus,
    line: &str,
    sync_label: &str,
    quitting: bool,
) -> Vec<TrayNode> {
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
    /* [V0.3.1] 「显示 / 隐藏」已移除：小条常驻，不再提供显隐入口
    （用户口径「去除显示与隐藏悬浮条功能」）。托盘左键单击仍会把小条叫出来
    （只显不隐），双击 = 高亮定位。 */
    nodes.push(TrayNode::item(ID_NEW_ITEM, "新建事项", true));
    nodes.push(TrayNode::item(ID_OPEN_TODOS, "打开事项", true));
    /* [V0.11.7] 紧随「打开事项」：同步的对象就是事项计时，位置贴着数据本身讲。
    文案纯文本、无符号（P0）；`enabled` 恒真——未启用同步时的反馈由点击侧给通知，
    不在这里灰置（灰置等于「点了没反应」，用户看不出该去哪儿开）。
    [V0.11.18] 文案参数化：通道 = 只用本地 → `Markdown 同步`（逐字沿用，老用户零变化），
    本地 + 云端 → `云端同步`（PRD TR1 / §4.2 TR3）。`ID_MD_SYNC` 一个字不动。 */
    nodes.push(TrayNode::item(ID_MD_SYNC, sync_label, true));
    nodes.push(TrayNode::item(ID_OPEN_NOTE, "便利贴…", true));
    nodes.push(TrayNode::item(ID_OPEN_SETTINGS, "设置…", true));
    nodes.push(TrayNode::Separator);
    /* [V0.11.18] 退出前那一轮同步正在跑 → 只把这一项换成「正在同步…」并置灰（PRD B7）。
    字面量逐字：`正在同步…` 用的是单个 `…`，不是三个点（品牌门禁与 P0 口径都按单字符）。 */
    nodes.push(if quitting {
        TrayNode::item(ID_QUIT, "正在同步…", false)
    } else {
        TrayNode::item(ID_QUIT, "退出", true)
    });
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
///
/// 实现已移到 `platform::duration`（倒计时通知也要用，不能只挂在桌面独占模块下），
/// 这里 re-export 保持既有调用点与测试路径不变。
pub use crate::platform::duration::format_duration;

/// 状态项里的名称：截断；空名回落「未命名」（设计稿 §3.3.1）。
fn display_name(item_name: &str) -> String {
    let truncated = truncate_name(item_name, LABEL_MAX_CHARS);
    if truncated.is_empty() {
        "未命名".to_string()
    } else {
        truncated
    }
}
