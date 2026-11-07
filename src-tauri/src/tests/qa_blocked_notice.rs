//! QA 独立复验 · B4「点了同步才知道云端没填全」（PRD §14.2）。
//!
//! 与工程师的 `tests/tray_sync_quit::blocked_notice_covers_off_and_not_filled` 的区别，
//! 也是这份文件存在的理由（**不从被测代码里抄答案**）：
//!
//! 1. 工程师那份把标题写成字面量 `"云端同步"` / `"Markdown 同步"`。字面量断言只能证明
//!    「今天是这个字符串」，证明不了「和菜单项是**同一个常量**」——哪天有人把菜单项改成
//!    「云同步」而这里没改，两份字面量各自为真、用户看到的却是两套说法。这里一律用
//!    `LOCAL_LABEL` / `CLOUD_LABEL` 常量，并另用一条用例把常量钉到菜单项实际渲染值上。
//! 2. 工程师那份只覆盖 `webdav` 三件套。**`localfolder` 载体是另一条判据**
//!    （`is_usable` 走 `local_root`），漏了它，「本地文件夹没选目录」这一档就没人看着。
//! 3. 逐档判据写成表驱动，加档只加一行；出现的顺序（① 总开关 → ② 未填全 → ③ 放行）
//!    就是 `blocked_notice` 的**优先级**，顺序错了表里会红。
//!
//! ## 这一层管不到的（如实交代）
//!
//! `run_once` 里「命中就只弹这一条并 `return`」要 `AppHandle`（真托盘 + 真通知），单元层拿不到，
//! 只能静态核对：`tray_sync.rs` 那个分支体只有 `notify_or_log` + `return`，`return` 之后才是
//! `md_cloud::round`。所以「只弹一条、不紧跟一条完成/没有变更」形状上成立，但无自动化证据。

use crate::app::tray_sync::{blocked_notice, CLOUD_LABEL, LOCAL_LABEL};
use crate::infra::tray_menu::{build_nodes, TrayNode, ID_MD_SYNC};
use crate::models::enums::TrayStatus;
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::tests::support::unique_dir;

/// v0.11.7 原文，逐字（只在这一处出现一次）；§14.2 新文案，逐字。
const V0117_BODY: &str = "先在设置里打开 Markdown 同步";
pub(super) const V0118_BODY: &str = "先在设置里填好云端";

/// 一份填全的 webdav（`is_usable() == true` 的对照档）。
pub(super) fn webdav_filled() -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        ..MdSyncCloud::default()
    }
}

/// 一份填全的本地文件夹（`is_usable() == true` 的另一载体）。
fn localfolder_filled() -> MdSyncCloud {
    let root = unique_dir("qa-blocked-localroot");
    std::fs::create_dir_all(&root).expect("建临时落点目录应成功");
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: root.to_string_lossy().into_owned(),
        ..MdSyncCloud::default()
    }
}

/// `(档名, 配置, 期望)`；`期望 == None` = 不该插话、这一下会真的跑。
type Tier = (&'static str, MdSyncConfig, Option<(&'static str, &'static str)>);

/// 十档判据。顺序 = `blocked_notice` 的优先级顺序（① 总开关 > ② 未填全 > ③ 放行）。
///
/// **标题取哪个常量，是从 PRD §14.2 的 B4 修订里读出来的，不是从实现里抄的**：
/// > ① 菜单项标签仍逐字 `Markdown 同步`（因为未填全 → 不生效，标签诚实）；
/// > ② 点它 → 系统通知**标题** `Markdown 同步`、**正文**逐字 `先在设置里填好云端`
///
/// 也就是说「未填全」那一档的标题 = 菜单项**此刻**显示的 `Markdown 同步`，不是 `云端同步`。
///
/// **但实现给的是 `云端同步`**（`tray_sync.rs` 的 `blocked_notice` 用 `CLOUD_LABEL`）——
/// 本表的「期望」列因此记的是**现状**（照片口径），冲突单独挂在
/// `qa_b4_notice_title_should_equal_the_menu_item_label`（`#[ignore]`，等你拍板）。
fn tiers() -> Vec<Tier> {
    let base = |enabled: bool, cloud: Option<MdSyncCloud>| MdSyncConfig {
        enabled,
        cloud,
        ..MdSyncConfig::default()
    };

    let mut missing_base_path = webdav_filled();
    missing_base_path.base_path = "   ".into(); // 全空格也算空：`.trim()` 之后是 ""

    let mut missing_user = webdav_filled();
    missing_user.user = String::new();

    let mut missing_root = localfolder_filled();
    missing_root.local_root = String::new();

    vec![
        (
            "1 · 总开关关着（出厂默认，cloud 也是 None）",
            MdSyncConfig::default(),
            Some((LOCAL_LABEL, V0117_BODY)),
        ),
        (
            "2 · 总开关关着，但云端早就配好了 —— ① 优先，仍是 v0.11.7 原文",
            base(false, Some(webdav_filled())),
            Some((LOCAL_LABEL, V0117_BODY)),
        ),
        (
            "3 · 开着 + 选云端 + webdav 三项全空",
            base(
                true,
                Some(MdSyncCloud {
                    enabled: true,
                    mode: CloudMode::Webdav,
                    ..MdSyncCloud::default()
                }),
            ),
            Some((CLOUD_LABEL, V0118_BODY)),
        ),
        (
            "4 · webdav 只缺 base_path（两个填了、一个空）",
            base(true, Some(missing_base_path)),
            Some((CLOUD_LABEL, V0118_BODY)),
        ),
        (
            "5 · webdav 只缺 user（全角/半角空白也算空）",
            base(true, Some(missing_user)),
            Some((CLOUD_LABEL, V0118_BODY)),
        ),
        (
            "6 · localfolder 载体、没选落点目录 —— 另一条判据，别漏",
            base(true, Some(missing_root)),
            Some((CLOUD_LABEL, V0118_BODY)),
        ),
        (
            "7 · 填全了（webdav）→ 不插话",
            base(true, Some(webdav_filled())),
            None,
        ),
        (
            "8 · 选了「只用本地」（字段都留着、enabled=false）→ 不插话",
            base(
                true,
                Some(MdSyncCloud {
                    enabled: false,
                    ..webdav_filled()
                }),
            ),
            None,
        ),
        (
            "9 · 从没配过云端（cloud=None）但总开关开着 → 纯本地，不插话",
            base(true, None),
            None,
        ),
        (
            "10 · 填全了（localfolder）→ 不插话，与 webdav 同权",
            base(true, Some(localfolder_filled())),
            None,
        ),
    ]
}

/// 主表：八档逐档对照，失败信息里带档名（不用逐个 `#[test]` 也能定位）。
#[test]
fn qa_blocked_notice_tier_table() {
    for (name, config, expected) in tiers() {
        assert_eq!(blocked_notice(&config), expected, "档 {name} 判错");
    }
}

/// 两句话都是逐字的，且**互不串台**：新文案不许出现在总开关关着的那一档，
/// 旧文案也不许出现在未填全那一档（串了就是用户按提示去了一个没用的地方）。
#[test]
fn qa_blocked_notice_two_bodies_never_swap() {
    let off = blocked_notice(&MdSyncConfig::default()).expect("总开关关着必须有话说");
    assert_eq!(off.1, V0117_BODY, "① 的正文必须逐字沿用 v0.11.7");

    let not_filled = blocked_notice(&MdSyncConfig {
        enabled: true,
        cloud: Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            ..MdSyncCloud::default()
        }),
        ..MdSyncConfig::default()
    })
    .expect("未填全必须有话说");
    assert_eq!(not_filled.1, V0118_BODY, "② 的正文必须与 PRD §14.2 逐字一致");

    assert_ne!(off.1, not_filled.1, "两档必须给不同的去处");
    assert_ne!(off.0, not_filled.0, "两档的标题也不该一样（一个本地、一个云端）");
}

/// 标题必须是**菜单项用的那个常量**，不是另抄一份字面量。
///
/// 做法：把常量钉到 `build_nodes` 实际渲染出来的那两项文字上。这样一旦有人改菜单文案
/// 而没改常量（或反过来），这条会红——两份字面量的写法做不到这件事。
#[test]
fn qa_notice_title_is_the_same_constant_as_the_menu_item() {
    let idle = TrayStatus::Idle;
    let line = "空闲 · 点开始正计时";

    let nodes_local = build_nodes(idle, line, LOCAL_LABEL, false);
    let nodes_cloud = build_nodes(idle, line, CLOUD_LABEL, false);
    let md_sync_label = |nodes: &[TrayNode]| {
        nodes
            .iter()
            .find_map(|node| match node {
                TrayNode::Item { id, label, .. } if *id == ID_MD_SYNC => Some(label.clone()),
                _ => None,
            })
            .expect("菜单里必须有 md_sync 这一项")
    };

    assert_eq!(md_sync_label(&nodes_local), LOCAL_LABEL, "本地档菜单项文字 ≠ LOCAL_LABEL");
    assert_eq!(md_sync_label(&nodes_cloud), CLOUD_LABEL, "云端档菜单项文字 ≠ CLOUD_LABEL");
    assert_ne!(LOCAL_LABEL, CLOUD_LABEL, "两个通道的菜单文字必须能区分");

    /* 标题必须取自这两个常量之一（不许另抄字面量）；哪一档用哪个，由下面那条
       「通知标题 == 同一份配置下菜单项此刻的文字」整体钉住。 */
    for (name, config, expected) in tiers() {
        if let Some((title, _)) = expected {
            assert!(
                title == LOCAL_LABEL || title == CLOUD_LABEL,
                "档 {name}：标题 {title} 不是菜单项常量之一"
            );
        }
        if let Some((title, _)) = blocked_notice(&config) {
            assert!(
                title == LOCAL_LABEL || title == CLOUD_LABEL,
                "档 {name}：实际标题 {title} 不是菜单项常量之一"
            );
        }
    }
}
