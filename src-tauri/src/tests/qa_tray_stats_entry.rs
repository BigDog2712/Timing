//! [V0.12.0 Patina 融合] 托盘「时间统计…」入口的结构判据。
//!
//! 为什么值得一条测试：Patina 的分析窗是整个融合里**唯一没有其它入口**的功能面
//! （悬浮条只有计时，设置页那行是第二选择）。托盘项掉了不会报错、不会崩，
//! 表现只是「功能凭空消失」，所以用纯函数 `build_nodes` 把结构钉住。

use crate::infra::tray_menu::{build_nodes, TrayNode, ID_OPEN_STATS, ID_OPEN_TODOS};
use crate::models::enums::TrayStatus;

/// 取菜单里全部文本项（跳过分隔线）。
fn items(nodes: &[TrayNode]) -> Vec<(&'static str, String, bool)> {
    nodes
        .iter()
        .filter_map(|n| match n {
            TrayNode::Item {
                id,
                label, enabled,
            } => Some((*id, label.clone(), *enabled)),
            TrayNode::Separator => None,
        })
        .collect()
}

#[test]
fn tray_has_stats_entry_right_after_todos() {
    let nodes = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时", "Markdown 同步", false);
    let list = items(&nodes);
    let pos = list
        .iter()
        .position(|(id, _, _)| *id == ID_OPEN_STATS)
        .expect("托盘必须有「时间统计…」项：它是 Patina 分析窗的唯一兜底入口");
    let (id, label, enabled) = &list[pos];
    assert_eq!(*id, ID_OPEN_STATS);
    // 文案口径与「设置…」「便利贴…」一致：带省略号，点了才开窗。
    assert_eq!(label, "时间统计…");
    assert!(label.ends_with('…'), "省略号必须是单个 … 而不是三个点");
    assert!(*enabled, "空闲态下统计入口不该被灰置");
    // 位置：紧跟「打开事项」——统计的对象就是事项计时。
    assert_eq!(list[pos - 1].0, ID_OPEN_TODOS);
}

#[test]
fn tray_stats_entry_survives_all_statuses_and_quitting() {
    for status in [
        TrayStatus::Idle,
        TrayStatus::Running,
        TrayStatus::Paused,
        TrayStatus::Countdown,
    ] {
        for quitting in [false, true] {
            let nodes = build_nodes(status, "任务 · 00:10", "Markdown 同步", quitting);
            let list = items(&nodes);
            assert!(
                list.iter().any(|(id, _, _)| *id == ID_OPEN_STATS),
                "状态 {status:?}（quitting={quitting}）下统计入口不该消失"
            );
        }
    }
}
