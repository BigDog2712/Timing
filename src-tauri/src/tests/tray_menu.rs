//! 托盘菜单构造（V0.2.0 批 1 · A4）：状态文本 / 截断 / 按状态裁剪。
//!
//! 断言来源：`ADR-013`（保留原生菜单 + 按状态裁剪）、
//! `docs/design/pages-V0.2.0/tray-menu.md §3.1 / §3.3`（P0：纯文本、无字符符号）。

use crate::infra::tray_menu::{
    build_nodes, format_duration, status_line, truncate_name, TrayNode, ID_NEW_ITEM,
    ID_OPEN_SETTINGS, ID_QUIT, ID_STATUS, ID_TIMER_DISCARD, ID_TIMER_PAUSE, ID_TIMER_RESUME,
    ID_TIMER_START, ID_TIMER_STOP, LABEL_MAX_CHARS,
};
use crate::models::enums::TrayStatus;

/// 「只用本地」通道下同步项的那一句（[V0.11.18] PRD §4.2 TR3：逐字沿用，老用户零变化）。
///
/// `build_nodes` 从 v0.11.18 起把文案作为参数收进来（判据在装配层，`infra` 不许读库），
/// 所以三个托盘测试文件都要有这一份。放在这里当**公共常量**：三个文件各写一个字面量，
/// 将来改文案就会漏其中一个。
pub(super) const LOCAL: &str = "Markdown 同步";

/// 「本地 + 云端」通道下同步项的那一句（PRD §4.1 TR1）。
pub(super) const CLOUD: &str = "云端同步";

/// 取节点里的所有 id（按出现顺序）。
pub(super) fn ids(nodes: &[TrayNode]) -> Vec<&'static str> {
    nodes
        .iter()
        .filter_map(|n| match n {
            TrayNode::Item { id, .. } => Some(*id),
            TrayNode::Separator => None,
        })
        .collect()
}

fn count_separators(nodes: &[TrayNode]) -> usize {
    nodes
        .iter()
        .filter(|n| matches!(n, TrayNode::Separator))
        .count()
}

pub(super) fn label_of(nodes: &[TrayNode], id: &str) -> Option<String> {
    nodes.iter().find_map(|n| match n {
        TrayNode::Item { id: nid, label, .. } if *nid == id => Some(label.clone()),
        _ => None,
    })
}

pub(super) fn enabled_of(nodes: &[TrayNode], id: &str) -> Option<bool> {
    nodes.iter().find_map(|n| match n {
        TrayNode::Item {
            id: nid, enabled, ..
        } if *nid == id => Some(*enabled),
        _ => None,
    })
}

/* --------------------------------- 状态文本 --------------------------------- */

#[test]
fn status_line_idle() {
    assert_eq!(status_line(TrayStatus::Idle, "", 0), "空闲 · 点开始正计时");
}

#[test]
fn status_line_running_and_paused() {
    assert_eq!(
        status_line(TrayStatus::Running, "摸鱼", 754),
        "摸鱼 · 12:34"
    );
    assert_eq!(
        status_line(TrayStatus::Paused, "摸鱼", 754),
        "摸鱼 · 已暂停 · 12:34"
    );
}

#[test]
fn status_line_missing_name_falls_back() {
    // 设计稿 §3.3.1：事项名缺失 -> 「未命名」（纯文本，无字符符号）
    assert_eq!(status_line(TrayStatus::Running, "", 61), "未命名 · 01:01");
    assert_eq!(
        status_line(TrayStatus::Running, "   ", 61),
        "未命名 · 01:01"
    );
}

#[test]
fn status_line_has_no_symbols() {
    // P0：状态项一律纯文本，不得含 ● / 圆点等字符符号
    let line = status_line(TrayStatus::Paused, "写周报", 65);
    assert!(!line.contains('●'), "不得含圆点符号");
    assert!(!line.contains('•'), "不得含项目符号");
    assert!(line.contains('·'), "分隔符应为 U+00B7：{line}");
}

/* --------------------------------- 名称截断 --------------------------------- */

#[test]
fn truncate_name_boundaries() {
    assert_eq!(truncate_name("摸鱼", LABEL_MAX_CHARS), "摸鱼");
    assert_eq!(
        truncate_name("  写周报  ", LABEL_MAX_CHARS),
        "写周报",
        "应去首尾空白"
    );
    let exact: String = "字".repeat(LABEL_MAX_CHARS);
    assert_eq!(
        truncate_name(&exact, LABEL_MAX_CHARS),
        exact,
        "恰好等长不截断"
    );
    let over: String = "字".repeat(LABEL_MAX_CHARS + 1);
    let out = truncate_name(&over, LABEL_MAX_CHARS);
    assert!(out.ends_with('…'), "超长应以单个 … 结尾：{out}");
    assert!(!out.ends_with("..."), "禁用三个英文点");
    assert_eq!(
        out.chars().count(),
        LABEL_MAX_CHARS + 1,
        "保留上限 + 省略号"
    );
}

#[test]
fn long_name_is_bounded_in_status_line() {
    let long = "品牌视觉改版-首页与落地页联动设计";
    let line = status_line(TrayStatus::Running, long, 754);
    assert!(line.ends_with("· 12:34"), "时长应完整保留：{line}");
    let name_part = line.split(" · ").next().unwrap();
    assert!(
        name_part.chars().count() <= LABEL_MAX_CHARS + 1,
        "名称部分应被截断：{name_part}"
    );
}

/* -------------------------------- 时长格式化 -------------------------------- */

#[test]
fn format_duration_ranges() {
    assert_eq!(format_duration(0), "00:00");
    assert_eq!(format_duration(59), "00:59");
    assert_eq!(format_duration(60), "01:00");
    assert_eq!(format_duration(3599), "59:59");
    assert_eq!(format_duration(3600), "01:00:00");
    assert_eq!(format_duration(3661), "01:01:01");
}

#[test]
fn format_duration_clamps() {
    assert_eq!(format_duration(-1), "00:00", "负值归零");
    assert_eq!(format_duration(99 * 3600 + 59 * 60 + 59), "99:59:59");
    assert_eq!(format_duration(1_000_000), "99:59:59", "上限 99:59:59");
}

/* -------------------------------- 按状态裁剪 -------------------------------- */

#[test]
fn idle_shows_only_start() {
    let line = status_line(TrayStatus::Idle, "", 0);
    let nodes = build_nodes(TrayStatus::Idle, &line, LOCAL, false);
    let ids = ids(&nodes);
    assert!(ids.contains(&ID_TIMER_START));
    assert!(!ids.contains(&ID_TIMER_PAUSE), "空闲不应出现「暂停」");
    assert!(!ids.contains(&ID_TIMER_RESUME), "空闲不应出现「继续」");
    assert!(!ids.contains(&ID_TIMER_STOP), "空闲不应出现「结束」");
    assert!(!ids.contains(&ID_TIMER_DISCARD), "空闲不应出现「放弃」");
}

#[test]
fn running_shows_pause_stop_discard() {
    let line = status_line(TrayStatus::Running, "摸鱼", 10);
    let nodes = build_nodes(TrayStatus::Running, &line, LOCAL, false);
    let ids = ids(&nodes);
    assert!(ids.contains(&ID_TIMER_PAUSE));
    assert!(ids.contains(&ID_TIMER_STOP));
    assert!(ids.contains(&ID_TIMER_DISCARD));
    assert!(!ids.contains(&ID_TIMER_START), "运行中不应出现「开始」");
    assert!(!ids.contains(&ID_TIMER_RESUME), "运行中不应出现「继续」");
}

#[test]
fn paused_shows_resume_stop_discard() {
    let line = status_line(TrayStatus::Paused, "摸鱼", 10);
    let nodes = build_nodes(TrayStatus::Paused, &line, LOCAL, false);
    let ids = ids(&nodes);
    assert!(ids.contains(&ID_TIMER_RESUME));
    assert!(ids.contains(&ID_TIMER_STOP));
    assert!(ids.contains(&ID_TIMER_DISCARD));
    assert!(!ids.contains(&ID_TIMER_START), "暂停中不应出现「开始」");
    assert!(!ids.contains(&ID_TIMER_PAUSE), "暂停中不应出现「暂停」");
}

#[test]
fn constant_items_always_present() {
    for status in [TrayStatus::Idle, TrayStatus::Running, TrayStatus::Paused] {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", LOCAL, false);
        let ids = ids(&nodes);
        assert!(ids.contains(&ID_STATUS), "{status:?} 应有状态项");
        /* [V0.3.1] 「显示 / 隐藏」项已移除（小条常驻，不再提供显隐入口） */
        assert!(!ids.contains(&"show_hide"), "{status:?} 不应再有显隐项");
        assert!(ids.contains(&ID_NEW_ITEM));
        assert!(ids.contains(&ID_OPEN_SETTINGS));
        assert!(ids.contains(&ID_QUIT));
        assert_eq!(count_separators(&nodes), 3, "{status:?} 应有 3 条分隔线");
        // 状态项恒为禁用（不可点，仅只读展示）
        assert_eq!(enabled_of(&nodes, ID_STATUS), Some(false));
        // 状态项文案 = 传入的 line（口径一致）
        assert_eq!(
            label_of(&nodes, ID_STATUS).as_deref(),
            Some("空闲 · 点开始正计时")
        );
    }
}

#[test]
fn menu_item_count_within_budget() {
    // 设计稿 §3.1：常态（空闲）≈10 项可点；计时 / 暂停略多。此处只保证「不失控」。
    for status in [TrayStatus::Idle, TrayStatus::Running, TrayStatus::Paused] {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", LOCAL, false);
        assert!(
            nodes.len() <= 14,
            "{status:?} 菜单项数 {} 超出预算",
            nodes.len()
        );
    }
}

#[test]
fn discard_item_is_last_of_control_group() {
    // 危险语义改由「位置 + 分隔线 + 文案」承载（设计稿 §3.4）：放弃不在「开始」之前。
    let nodes = build_nodes(TrayStatus::Running, "摸鱼 · 00:10", LOCAL, false);
    let ids = ids(&nodes);
    let pause = ids.iter().position(|i| *i == ID_TIMER_PAUSE).unwrap();
    let stop = ids.iter().position(|i| *i == ID_TIMER_STOP).unwrap();
    let discard = ids.iter().position(|i| *i == ID_TIMER_DISCARD).unwrap();
    assert!(
        pause < stop && stop < discard,
        "控制组顺序应为 暂停 < 结束 < 放弃"
    );
    assert_eq!(
        label_of(&nodes, ID_TIMER_DISCARD).as_deref(),
        Some("放弃（不记录）")
    );
}

/* --------------------------- 集成：快照 -> 状态文本 --------------------------- */

/// 端到端：真实会话 -> `tray_snapshot` -> 状态行文案（验证状态迁移驱动文案/裁剪）。
#[tokio::test]
async fn snapshot_reflects_session_state() {
    use crate::services::timer;
    use crate::tests::support::{fresh_pool, new_item};

    let pool = fresh_pool("tray-snapshot").await;
    let item_id = new_item(&pool, "摸鱼").await;
    timer::start(&pool, Some(item_id)).await.unwrap();

    let state = timer::state(&pool).await.unwrap();
    let snap = timer::tray_snapshot(&pool, &state).await.unwrap();
    assert_eq!(snap.status, TrayStatus::Running);
    assert_eq!(snap.item_name, "摸鱼");
    assert!(
        status_line(snap.status, &snap.item_name, snap.duration_sec).starts_with("摸鱼 · "),
        "计时中文案应以事项名开头"
    );

    timer::pause(&pool).await.unwrap();
    let state = timer::state(&pool).await.unwrap();
    let snap = timer::tray_snapshot(&pool, &state).await.unwrap();
    assert_eq!(snap.status, TrayStatus::Paused);
    assert!(status_line(snap.status, &snap.item_name, snap.duration_sec).contains("已暂停"));
}
