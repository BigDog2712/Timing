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

use super::tray_menu::{enabled_of, ids, label_of};

/// 用户口径：托盘右键菜单里点一下就跑一次双向同步，不必先进设置页。
#[test]
fn md_sync_item_exists_with_plain_label() {
    for status in [TrayStatus::Idle, TrayStatus::Running, TrayStatus::Paused] {
        let nodes = build_nodes(status, "空闲 · 点开始正计时");
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

/// 位置：新建事项 / 打开事项 / Markdown 同步 / 便利贴… / 设置…。
///
/// 顺序是产品口径的一部分（同步紧跟「打开事项」，因为它同步的就是事项计时），
/// 所以钉**相邻**关系，而不只是「存在」。
#[test]
fn md_sync_item_sits_between_open_todos_and_note() {
    let nodes = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时");
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
    let nodes: Vec<TrayNode> = build_nodes(TrayStatus::Idle, "空闲 · 点开始正计时");
    let label = label_of(&nodes, ID_MD_SYNC).expect("节点应存在");
    assert!(
        label
            .chars()
            .all(|c| c.is_alphanumeric() || c.is_whitespace()),
        "文案只允许文字与空格：{label}"
    );
}
