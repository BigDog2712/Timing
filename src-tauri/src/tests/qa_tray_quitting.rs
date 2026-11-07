//! QA 复验 · V0.11.18 B7b：`build_nodes` 的 `quitting` 只改退出项（PRD §14.3 / B7b）。
//!
//! ## 这条判据的形状为什么这么写
//!
//! B7b 的**可见**部分只能在真机上人点托盘验（一次正常同步可能只跑 200 ms，菜单还没画出来
//! 进程就退了 —— PRD §14.3 已经把这件事写进判据：> 300 ms 才要求看到这一帧）。所以机器能钉
//! 的只有「装配层算出来的那一份菜单是什么」，本文件就是这一层。
//!
//! 这里刻意**不看实现**去写断言，而是按判据的四个要求逐条钉：
//! 1. 退出项 label **逐字** `正在同步…` —— 单个 `…`（U+2026），不是 `...`、不是 `。。`；
//! 2. 退出项 `enabled === false`（不可点：这一轮已经在跑了，再点一次「退出」没有意义）；
//! 3. **其余项一个字不动**（文案 + 启用态逐项相等）—— 这条最容易漏，也最容易被用户看见
//!    （菜单高度/顺序跳一下）；
//! 4. id 序列完全一致（结构不变，只换那一个 label）。

use crate::infra::tray_menu::{build_nodes, TrayNode, ID_MD_SYNC, ID_QUIT};
use crate::models::enums::TrayStatus;

/// 三种状态都验：`quitting` 与「正在计时 / 暂停」是正交的，装配层不该有任何耦合。
const STATES: [TrayStatus; 3] = [TrayStatus::Idle, TrayStatus::Running, TrayStatus::Paused];

fn label_of(nodes: &[TrayNode], id: &str) -> Option<String> {
    nodes.iter().find_map(|node| match node {
        TrayNode::Item { id: node_id, label, .. } if *node_id == id => Some(label.clone()),
        _ => None,
    })
}

fn enabled_of(nodes: &[TrayNode], id: &str) -> Option<bool> {
    nodes.iter().find_map(|node| match node {
        TrayNode::Item { id: node_id, enabled, .. } if *node_id == id => Some(*enabled),
        _ => None,
    })
}

/// 「除退出项之外的一切」的快照：id / label / enabled，顺序敏感。
fn others(nodes: &[TrayNode]) -> Vec<(String, String, bool)> {
    nodes
        .iter()
        .filter_map(|node| match node {
            TrayNode::Item { id, label, enabled } if *id != ID_QUIT => {
                Some((id.to_string(), label.clone(), *enabled))
            }
            _ => None,
        })
        .collect()
}

/// 退出项的 label 逐字 `正在同步…`，且那个省略号是**单个** U+2026。
#[test]
fn quitting_quit_item_is_labelled_with_a_single_ellipsis() {
    for status in STATES {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", "Markdown 同步", true);
        let label = label_of(&nodes, ID_QUIT).expect("菜单里必须有退出项");

        assert_eq!(label, "正在同步…", "{status:?} 的退出项文案不对");
        /* 逐字符复核：5 个字符 = 正 / 在 / 同 / 步 / …（U+2026 是一个字符） */
        assert_eq!(label.chars().count(), 5, "{status:?}：省略号不是单个字符");
        assert_eq!(label.chars().last(), Some('\u{2026}'), "必须是 U+2026");
        assert!(!label.contains("..."), "不许用三个 ASCII 点");
        assert_eq!(enabled_of(&nodes, ID_QUIT), Some(false), "{status:?}：退出项必须不可点");
    }
}

/// 非退出态逐字 `退出`、且可点（别把上一轮的 `quitting` 漏成默认值）。
#[test]
fn normal_quit_item_stays_plain_and_clickable() {
    for status in STATES {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", "Markdown 同步", false);
        assert_eq!(label_of(&nodes, ID_QUIT).as_deref(), Some("退出"), "{status:?}");
        assert_eq!(enabled_of(&nodes, ID_QUIT), Some(true), "{status:?}");
    }
}

/// `quitting` 只改退出项：其余项的 id / 文案 / 启用态**逐项相等**，id 序列整体不变。
#[test]
fn quitting_changes_nothing_but_the_quit_item() {
    for status in STATES {
        let normal = build_nodes(status, "空闲 · 点开始正计时", "Markdown 同步", false);
        let quitting = build_nodes(status, "空闲 · 点开始正计时", "Markdown 同步", true);

        assert_eq!(normal.len(), quitting.len(), "{status:?}：菜单项数量变了");
        assert_eq!(others(&normal), others(&quitting), "{status:?}：退出项以外的项被改动了");
        /* 防空转：如果 `build_nodes` 干脆忽略 `quitting`，上面两条断言会**恒真**通过。
           这一条要求退出项确实被改过，变异（忽略 quitting）才会把这条打红。 */
        assert_ne!(
            label_of(&normal, ID_QUIT),
            label_of(&quitting, ID_QUIT),
            "{status:?}：quitting 必须真的改了退出项，否则本测试是空转"
        );
        /* 文件 `tray_menu.rs` 的注释承诺「通道切换只换那一项的文字」；这里把 `quitting`
           的那一项也一起钉住：同步项（`md_sync`）**不在**被改之列。 */
        assert_eq!(
            label_of(&normal, ID_MD_SYNC),
            label_of(&quitting, ID_MD_SYNC),
            "{status:?}：同步项文案不该随 quitting 变"
        );
        /* 退出项仍是最后一个可点位置，位置不变 */
        let pos_normal = normal.iter().position(|node| matches!(node, TrayNode::Item { id, .. } if *id == ID_QUIT));
        let pos_quitting = quitting.iter().position(|node| matches!(node, TrayNode::Item { id, .. } if *id == ID_QUIT));
        assert_eq!(pos_normal, pos_quitting, "{status:?}：退出项位置变了");
    }
}
