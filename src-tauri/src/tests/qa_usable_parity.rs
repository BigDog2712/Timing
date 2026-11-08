//! QA 复验 · V0.11.18 A6 → V0.11.26 双通路平移：前端 `isXxxReady` 与后端
//! `md_cloud::usable_folder / usable_webdav` 的**逐档对齐**。
//!
//! ## 为什么要两份表
//!
//! 「填全」的定义后端说了算（`usable_*` → `MdSyncCloudChannel::is_usable_*`）。前端拿不到
//! 它（视图只回 `MdSyncCloudStatus`，没有字段本身），所以在前端复制一份判据。
//! **复制一份判据 = 埋一个迟早分叉的地方。** 本文件与前端 `mdSyncV0118Ready.test.ts`
//! 用的是**同一张表**：任何一边改了口径，对应那一侧的用例立刻红。
//!
//! ## 表的来源（不是从实现抄的）
//!
//! 逐条读 `models/md_sync_channel.rs::is_usable_*` 后**手写**期望值：
//! `!enabled → false`；folder 只看 `local_root.trim()`；webdav 要三件套 trim 后非空；
//! 密文不参与。
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_channel::MdSyncCloudChannel;
use crate::services::md_cloud;

fn webdav(base_url: &str, base_path: &str, user: &str) -> MdSyncCloudChannel {
    MdSyncCloudChannel {
        enabled: true,
        base_url: base_url.into(),
        base_path: base_path.into(),
        user: user.into(),
        ..MdSyncCloudChannel::default()
    }
}

fn folder(local_root: &str) -> MdSyncCloudChannel {
    MdSyncCloudChannel {
        enabled: true,
        local_root: local_root.into(),
        ..MdSyncCloudChannel::default()
    }
}

fn config_of(
    folder_channel: Option<MdSyncCloudChannel>,
    webdav_channel: Option<MdSyncCloudChannel>,
) -> MdSyncConfig {
    MdSyncConfig {
        enabled: true,
        cloud_folder: folder_channel,
        cloud_webdav: webdav_channel,
        ..MdSyncConfig::default()
    }
}

/// 一张十档验收表：`(名字, 配置, folder 期望, webdav 期望)`。
///
/// **必须与前端 `mdSyncV0118Ready.test.ts` 的 `CASES` 逐档同源**（含顺序与名字）。
fn table() -> Vec<(&'static str, MdSyncConfig, bool, bool)> {
    vec![
        (
            "1 · folder + 通路关着（enabled:false，字段都留着）",
            config_of(
                Some(MdSyncCloudChannel { enabled: false, ..folder("D:////md") }),
                None,
            ),
            false,
            false,
        ),
        ("2 · folder + 落点为空", config_of(Some(folder("")), None), false, false),
        (
            "3 · folder + 落点只有空格",
            config_of(Some(folder("   ")), None),
            false,
            false,
        ),
        (
            "4 · folder + 落点有值",
            config_of(Some(folder("D:////Nutstore////Timing")), None),
            true,
            false,
        ),
        (
            "5 · folder + 落点有值、WebDAV 三件套全空（互不影响）",
            config_of(Some(folder("D:////md")), Some(webdav("", "", ""))),
            true,
            false,
        ),
        ("6 · webdav + 三件套全空", config_of(None, Some(webdav("", "", ""))), false, false),
        (
            "7 · webdav + 只缺 user",
            config_of(None, Some(webdav("https://dav.jianguoyun.com/dav/", "/Timing", ""))),
            false,
            false,
        ),
        (
            "8 · webdav + baseUrl 只有空格",
            config_of(None, Some(webdav("   ", "/Timing", "me@example.com"))),
            false,
            false,
        ),
        (
            "9 · webdav + 三件套填全",
            config_of(
                None,
                Some(webdav("https://dav.jianguoyun.com/dav/", "/Timing", "me@example.com")),
            ),
            false,
            true,
        ),
        (
            "10 · webdav 填全但 enabled=false（配过、现在关着）",
            config_of(
                None,
                Some(MdSyncCloudChannel {
                    enabled: false,
                    ..webdav("https://dav.jianguoyun.com/dav/", "/Timing", "me@example.com")
                }),
            ),
            false,
            false,
        ),
    ]
}

/// 一张十档表，两条通路各念一遍。
///
/// ⚠️ 口径提醒：`usable_*()` **不看**顶层总开关 `config.enabled` —— 它只回答「这条通路
/// 此刻能不能跑」。总开关关着时它仍可能返回 `Some`，只是 `round` 自己会按关处理。
#[test]
fn usable_matches_the_shared_table() {
    for (name, config, folder_expected, webdav_expected) in table() {
        assert_eq!(
            md_cloud::usable_folder(&config).is_some(),
            folder_expected,
            "后端 `usable_folder()` 与验收表不一致：{name}"
        );
        assert_eq!(
            md_cloud::usable_webdav(&config).is_some(),
            webdav_expected,
            "后端 `usable_webdav()` 与验收表不一致：{name}"
        );
    }
}

/// 双通路同时配置：互不串判（[V0.11.26] 的隔离判据）。
#[test]
fn two_channels_are_judged_independently() {
    let config = config_of(
        Some(folder("D:////md")),
        Some(webdav("https://dav.jianguoyun.com/dav/", "/Timing", "me@example.com")),
    );
    assert!(md_cloud::usable_folder(&config).is_some());
    assert!(md_cloud::usable_webdav(&config).is_some());
    let webdav_only = config_of(
        None,
        Some(webdav("https://dav.jianguoyun.com/dav/", "/Timing", "me@example.com")),
    );
    assert!(md_cloud::usable_folder(&webdav_only).is_none(), "folder 侧不许被 webdav 的字段点亮");
}

/// `cloud_folder / cloud_webdav` 都缺（V0.11.12 及以前的老配置）单独一档：
/// 两条通路都必须是 `None` —— 否则一次升级就会替用户开始往云端写东西。
#[test]
fn absent_channels_are_never_usable() {
    let config = config_of(None, None);
    assert!(md_cloud::usable_folder(&config).is_none());
    assert!(md_cloud::usable_webdav(&config).is_none());
}

/// 密文不参与判定：`MdSyncCloudChannel` 结构里根本没有密码字段。
#[test]
fn password_is_not_part_of_the_struct() {
    let channel = webdav("https://x/dav/", "/Timing", "me@example.com");
    let json = serde_json::to_value(channel).unwrap();
    let keys: Vec<&String> = json.as_object().unwrap().keys().collect();
    assert!(
        !keys.iter().any(|key| key.contains("secret") || key.contains("password")),
        "通路配置结构里不许出现密码 / 密文字段：{keys:?}"
    );
}
