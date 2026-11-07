//! 托盘菜单批 2 增量：倒计时状态行 + 新常显项（打开事项 / 便利贴…）。

use crate::infra::tray_menu::{
    build_nodes, countdown_status_line, TrayNode, ID_OPEN_NOTE, ID_OPEN_TODOS, ID_TIMER_DISCARD,
    ID_TIMER_PAUSE, ID_TIMER_RESUME, ID_TIMER_START, ID_TIMER_STOP,
};
use crate::models::enums::TrayStatus;

use super::tray_menu::LOCAL;

fn ids(nodes: &[TrayNode]) -> Vec<&'static str> {
    nodes
        .iter()
        .filter_map(|n| match n {
            TrayNode::Item { id, .. } => Some(*id),
            TrayNode::Separator => None,
        })
        .collect()
}

#[test]
fn countdown_status_line_format() {
    assert_eq!(
        countdown_status_line("摸鱼", 7 * 60 + 26),
        "摸鱼 · 倒计时 剩 07:26"
    );
    assert_eq!(countdown_status_line("", 90), "倒计时 · 剩 01:30");
    // 纯文本：无圆点 / 项目符号（P0）
    let line = countdown_status_line("写周报", 65);
    assert!(!line.contains('●') && !line.contains('•'), "不得含字符符号");
    // 负值归零
    assert_eq!(countdown_status_line("x", -5), "x · 倒计时 剩 00:00");
}

#[test]
fn countdown_control_group_shows_pause_stop_discard() {
    let nodes = build_nodes(TrayStatus::Countdown, "摸鱼 · 倒计时 剩 07:26", LOCAL, false);
    let ids = ids(&nodes);
    assert!(ids.contains(&ID_TIMER_PAUSE));
    assert!(ids.contains(&ID_TIMER_STOP));
    assert!(ids.contains(&ID_TIMER_DISCARD));
    assert!(!ids.contains(&ID_TIMER_START), "倒计时中不应出现「开始」");
    assert!(!ids.contains(&ID_TIMER_RESUME), "倒计时中不应出现「继续」");
}

#[test]
fn new_tray_items_present_in_all_states() {
    for status in [
        TrayStatus::Idle,
        TrayStatus::Running,
        TrayStatus::Countdown,
        TrayStatus::Paused,
    ] {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", LOCAL, false);
        let ids = ids(&nodes);
        assert!(ids.contains(&ID_OPEN_TODOS), "{status:?} 应含「打开事项」");
        assert!(ids.contains(&ID_OPEN_NOTE), "{status:?} 应含「便利贴…」");
        // 结构仍在预算内（K-30：避免菜单失控）
        assert!(nodes.len() <= 14, "{status:?} 菜单项数 {}", nodes.len());
    }
}
