//! QA 复验 · V0.11.18 A6：前端 `isCloudReady` 与后端 `md_cloud::usable` 的**逐档对齐**。
//!
//! ## 为什么要两份表
//!
//! A6 的文案前端说了算，但「填全」的定义后端说了算（`md_cloud::usable` →
//! `MdSyncCloud::is_usable`）。前端拿不到 `is_usable`（视图只回 `MdSyncCloudStatus`，
//! 没有字段本身），所以只能在前端复制一份 `isCloudReady`。
//!
//! **复制一份判据 = 埋一个迟早分叉的地方。** 本文件与前端
//! `mdSyncV0118Ready.test.ts` 用的是**同一张表**（同样十档、同样顺序、同样名字）：
//! 任何一边改了口径，对应那一侧的用例立刻红，红的位置直接告诉人「是前端还是后端改了定义」。
//!
//! ## 表的来源（不是从实现抄的）
//!
//! 逐条读 `models/md_sync_cloud.rs::is_usable` 后**手写**期望值：
//! `!enabled → false`；`localfolder` 只看 `local_root.trim()`；`webdav` 要
//! `base_url` + `base_path` + `user` 三个 trim 后非空；密文不参与。
//!
//! 十档里有四档是「看起来填了、其实不算」或反过来的陷阱档：
//! - 3：`localRoot` 只有空格 → 假（`.trim()` 的意义）；
//! - 5：`localfolder` 载体、WebDAV 三件套全空但落点有值 → **真**（那条路不发网络请求，
//!   地址 / 账号与它无关）—— 最容易写错的一档；
//! - 8：`baseUrl` 只有空格 → 假；
//! - 10：字段都留着、`enabled: false`（配过、现在只用本地）→ 假。
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::services::md_cloud;

fn webdav(base_url: &str, base_path: &str, user: &str) -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        local_root: String::new(),
        base_url: base_url.into(),
        base_path: base_path.into(),
        user: user.into(),
        /* [V0.11.19] 三档与「填全」判定无关，这里显式留空保持原夹具语义。 */
        auto: None,
    }
}

fn folder(local_root: &str) -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: local_root.into(),
        base_url: String::new(),
        base_path: String::new(),
        user: String::new(),
        /* [V0.11.19] 同上：三档不参与 `is_usable()`。 */
        auto: None,
    }
}

fn config_of(cloud: MdSyncCloud) -> MdSyncConfig {
    MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: Vec::new(),
        cloud: Some(cloud),
    }
}

/// 十档验收表：`(名字, 配置, 期望 usable)`。
///
/// **必须与前端 `mdSyncV0118Ready.test.ts` 的 `CASES` 逐档相同**（含顺序与名字）。
fn table() -> Vec<(&'static str, MdSyncConfig, bool)> {
    vec![
        (
            "1 · localfolder + 通道关着（enabled:false，字段都留着）",
            config_of(MdSyncCloud {
                enabled: false,
                ..folder("D:\\md")
            }),
            false,
        ),
        ("2 · localfolder + 落点为空", config_of(folder("")), false),
        (
            "3 · localfolder + 落点只有空格",
            config_of(folder("   ")),
            false,
        ),
        (
            "4 · localfolder + 落点有值",
            config_of(folder("D:\\Nutstore\\Timing")),
            true,
        ),
        (
            "5 · localfolder + 落点有值、WebDAV 三件套全空（不影响）",
            config_of(folder("D:\\md")),
            true,
        ),
        (
            "6 · webdav + 三件套全空",
            config_of(webdav("", "", "")),
            false,
        ),
        (
            "7 · webdav + 只缺 user",
            config_of(webdav("https://dav.jianguoyun.com/dav/", "/Timing", "")),
            false,
        ),
        (
            "8 · webdav + baseUrl 只有空格",
            config_of(webdav("   ", "/Timing", "me@example.com")),
            false,
        ),
        (
            "9 · webdav + 三件套填全",
            config_of(webdav(
                "https://dav.jianguoyun.com/dav/",
                "/Timing",
                "me@example.com",
            )),
            true,
        ),
        (
            "10 · webdav 填全但 enabled=false（配过、现在只用本地）",
            config_of(MdSyncCloud {
                enabled: false,
                ..webdav("https://dav.jianguoyun.com/dav/", "/Timing", "me@example.com")
            }),
            false,
        ),
    ]
}

/// 一张十档表，两个方向各念一遍。
///
/// ⚠️ 口径提醒（我第一版就写错过）：`usable()` **不看**顶层总开关 `config.enabled` ——
/// 它只回答「云端这一条通道此刻能不能跑」（`cloud.enabled && is_usable()`）。总开关关着时
/// `usable()` 仍可能返回 `Some`，只是 `md_sync::run` 自己会按关处理、什么也不做。
/// 界面的 A6 判据同样只看 `cloud.enabled`（`{cloud.enabled && status}`），两边同口径；
/// 但「顶层总开关」是**第三个轴**，别混进这张表（它属 B4 的第 ① 档）。
#[test]
fn usable_matches_the_shared_table() {
    for (name, config, expected) in table() {
        assert_eq!(
            md_cloud::usable(&config).is_some(),
            expected,
            "后端 `usable()` 与验收表不一致：{name}"
        );
    }
}

/// `cloud: None`（V0.11.12 及以前的老配置）单独一档：不在「云端字段」表里，但是同一件事的
/// 另一面 —— `usable()` 必须是 `None`（否则一次升级就会替用户开始往云端写东西）。
#[test]
fn absent_cloud_is_never_usable() {
    let config = MdSyncConfig {
        enabled: true,
        poll_secs: 900,
        bindings: Vec::new(),
        cloud: None,
    };
    assert!(md_cloud::usable(&config).is_none(), "`cloud: None` 不许被当成可用");
}

/// 密文不参与判定：`MdSyncCloud` 结构里根本没有密码字段。
///
/// 这条挡住「将来有人把 `has_secret` 塞进这个结构并影响 `is_usable`」——
/// 那会让「填全了但没密码」从「算可用（然后报『还没保存应用密码』）」变成「不算可用」，
/// 界面上就会从「状态行说失败原因」退化成「永远显示还没填全」。
#[test]
fn password_is_not_part_of_the_struct() {
    let cloud = webdav("https://x/dav/", "/Timing", "me@example.com");
    let json = serde_json::to_value(cloud).unwrap();
    let keys: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert!(
        !keys.iter().any(|key| key.contains("secret") || key.contains("password")),
        "云端配置结构里不许出现密码 / 密文字段：{keys:?}"
    );
    /* 填全即算可用（密码为空也一样）—— 与 PRD §14.4 的现象表一致 */
    assert!(md_cloud::usable(&config_of(webdav(
        "https://x/dav/",
        "/Timing",
        "me@example.com"
    )))
    .is_some());
}
