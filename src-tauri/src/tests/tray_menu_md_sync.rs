//! 托盘菜单「Markdown 同步」项（V0.11.7）。
//!
//! 从 `tray_menu.rs` 拆出来：那边已经 260 行，再加三组断言就过 300 行门禁（ADR-017）。
//! 拆分口径是**需求来源**：那边钉「按计时状态裁剪 / 文案口径」（V0.2.0 A4），
//! 这里钉「V0.11.7 新增的一枚菜单项」——改一处的理由不同，不该互相带着跑。
//!
//! 断言对象仍是纯函数 `build_nodes`，所以「点了会不会真的同步」不在覆盖范围内：
//! 那条路径要人点原生菜单才看得到（见交付报告「未验证」一节）。

use crate::infra::tray_menu::{
    build_nodes, TrayNode, ID_MD_SYNC, ID_NEW_ITEM, ID_OPEN_NOTE, ID_OPEN_SETTINGS, ID_OPEN_TODOS,
    ID_QUIT,
};
use crate::models::enums::TrayStatus;

use super::tray_menu::{enabled_of, ids, label_of, CLOUD, LOCAL};

/// 用户口径：托盘右键菜单里点一下就跑一次双向同步，不必先进设置页。
#[test]
fn md_sync_item_exists_with_plain_label() {
    for status in [TrayStatus::Idle, TrayStatus::Running, TrayStatus::Paused] {
        let nodes = build_nodes(status, "空闲 · 点开始正计时", LOCAL);
        assert_eq!(
            label_of(&nodes, ID_MD_SYNC).as_deref(),
            Some("Markdown 同步"),
            "{status:?} 的文案必须与用户口径逐字一致"
        );
        /* 三个状态都可点：同步与计时状态无关（计时中改了 md 也该能同步回来）。
        未启用同步时的反馈走点击侧的通知，不在这里灰置——灰置等于「点了没反应」，
        用户看不出该去哪儿开。 */
        assert_eq!(enabled_of(&nodes, ID_MD_SYNC), Some(true), "{status:?}");
    }
}

/* ===== [V0.11.18] TR1a / TR1d：标签随通道变，但菜单项**恒为 1 项**、id 不变 ===== */

/// TR1a + TR2d：两档标签各自只生成**一个** `ID_MD_SYNC` 项，且位置一字不动。
///
/// 判据的实质是「**换标签不换结构**」：菜单项数量一多一少，用户在两次右键之间会看到
/// 菜单高度跳一下（PRD B5）。所以这里对两档各数一遍，并把 id 序列整串钉死。
#[test]
fn sync_item_label_switches_but_menu_shape_does_not() {
    let local = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时", LOCAL);
    let cloud = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时", CLOUD);

    assert_eq!(label_of(&local, ID_MD_SYNC).as_deref(), Some(LOCAL));
    assert_eq!(label_of(&cloud, ID_MD_SYNC).as_deref(), Some(CLOUD));
    /* 数量：两档都恰好 1 项（不是「新增一项」） */
    assert_eq!(ids(&local).iter().filter(|id| **id == ID_MD_SYNC).count(), 1);
    assert_eq!(ids(&cloud).iter().filter(|id| **id == ID_MD_SYNC).count(), 1);
    /* 结构：id 序列逐项相同 —— 只有那个 label 变了 */
    assert_eq!(ids(&local), ids(&cloud));
}

/// TR1d：`ID_MD_SYNC` 常量值仍是 `"md_sync"`（前端 / 脚本可能按它分发）。
#[test]
fn sync_item_id_is_still_md_sync() {
    assert_eq!(ID_MD_SYNC, "md_sync");
}

/// 位置：新建事项 / 打开事项 / Markdown 同步 / 便利贴… / 设置…。
///
/// 顺序是产品口径的一部分（同步紧跟「打开事项」，因为它同步的就是事项计时），
/// 所以钉**相邻**关系，而不只是「存在」。
#[test]
fn md_sync_item_sits_between_open_todos_and_note() {
    let nodes = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时", LOCAL);
    let ids = ids(&nodes);
    let pos = |want: &str| ids.iter().position(|id| *id == want).expect("节点应存在");

    assert!(
        pos(ID_NEW_ITEM) < pos(ID_OPEN_TODOS),
        "「新建事项」应仍在「打开事项」之前"
    );
    assert!(
        pos(ID_OPEN_TODOS) < pos(ID_MD_SYNC),
        "「Markdown 同步」应紧随「打开事项」之后"
    );
    assert!(
        pos(ID_MD_SYNC) < pos(ID_OPEN_NOTE),
        "「Markdown 同步」应在「便利贴…」之前"
    );
    assert_eq!(
        pos(ID_OPEN_NOTE) + 1,
        pos(ID_OPEN_SETTINGS),
        "「便利贴…」与「设置…」仍相邻"
    );
    assert_eq!(pos(ID_QUIT), ids.len() - 1, "退出恒为最后一项");
}

/// P0：纯文本、无 emoji、无字符符号（与状态行同一口径）。
#[test]
fn md_sync_label_has_no_symbols_or_emoji() {
    let nodes: Vec<TrayNode> = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时", LOCAL);
    let label = label_of(&nodes, ID_MD_SYNC).expect("节点应存在");
    assert!(
        label
            .chars()
            .all(|c| c.is_alphanumeric() || c.is_whitespace()),
        "文案只允许文字与空格：{label}"
    );
}
