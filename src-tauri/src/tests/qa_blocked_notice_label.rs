//! `blocked_notice` 的真库半场（PRD §14.2）：标签读生效通道、通知标题该取哪个常量。
//!
//! 拆成两个文件是因为「单文件 ≤300 行」硬门禁（ADR-017，零豁免）：`qa_blocked_notice.rs`
//! 放十档纯函数表，这里放需要真库的 `sync_label` 对照。夹具与常量从那边 `use` 过来，
//! **绝不复制**（复制一份 `webdav_filled` 就等于复制一份「填全」的定义，两处会漂）。
//!
//! ## 本文件的头号判据是**不变量**，不是一组例子
//!
//! 「通知标题必须与用户刚刚点的那一项标签逐字相同」是对**所有**弹通知的档位都成立的规矩，
//! 所以它必须用一条**遍历式**断言钉住：拿配置空间的笛卡尔积逐个比
//! `blocked_notice(cfg).title` 与 `sync_label(cfg)`。手抄两档写成两条例子不算钉住——
//! 将来新增第三档时，那两条例子照样绿。
//!
//! 维护契约见 `config_space()` 的文档：只有出现**不在这几个维度上**的新判据才需要改它。
//!
//! ## 这一层管不到的（如实交代）
//!
//! `run_once` 里「命中就只弹这一条并 `return`」要 `AppHandle`（真托盘 + 真通知），单元层拿不到，
//! 只能静态核对：`tray_sync.rs` 那个分支体只有 `notify_or_log` + `return`，`return` 之后才是
//! `md_cloud::round`。所以「只弹一条、不紧跟一条完成/没有变更」形状上成立，但无自动化证据。

use sqlx::SqlitePool;

use super::qa_blocked_notice::{cfg_of, localfolder_filled, webdav_filled, V0118_BODY};
use crate::app::tray_label::{blocked_notice, sync_label, CLOUD_LABEL, LOCAL_LABEL};
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_channel;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::repositories::settings;
use crate::services::md_sync::config;
use crate::tests::support::fresh_pool;

/// 真库直写配置（绕过 `config::validate`：判据里有「`enabled: true` 但字段空」这一档，
/// 而 `validate_webdav` 会拒绝它，可它在真机上确实存在）。
pub(super) async fn store(pool: &SqlitePool, cfg: &MdSyncConfig) {
    let raw = serde_json::to_string(cfg).expect("配置应能序列化");
    settings::set_value(pool, config::CONFIG_KEY, &raw, 0)
        .await
        .expect("写 settings 应成功");
}

#[tokio::test]
async fn qa_sync_label_follows_effective_channel_not_the_selection() {
    let pool = fresh_pool("qa-blocked-label").await;

    /* ① 选了云端（字段还填全了）但 Markdown 总开关关着 → 标签是 `Markdown 同步`。
       [V0.11.18 裁决后] 这一帧已被修掉：`md_cloud::usable()` 不看顶层 `config.enabled`，
       所以 `sync_label` 单独判了一次。原实现给的是 `云端同步` —— 那句是假话：
       总开关关着时这一轮连 `md_sync::run` 都不会进，点下去弹的却是「先在设置里打开
       Markdown 同步」。断言因此从「现状照片」改成「判据」。 */
    store(&pool, &cfg_of(false, Some(webdav_filled()))).await;
    assert_eq!(
        sync_label(&pool).await,
        LOCAL_LABEL,
        "总开关关着：不会跑云端，标签必须是「Markdown 同步」（`sync_label` 单独判了总开关）"
    );

    /* ② 开了 + 选了云端 + 没填全 → 标签回落本地（`usable()` 为 None） */
    let not_filled = cfg_of(
        true,
        Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            ..MdSyncCloud::default()
        }),
    );
    store(&pool, &not_filled).await;
    assert_eq!(
        sync_label(&pool).await,
        LOCAL_LABEL,
        "没填全 = 这一轮仍走 md_sync::run，标签写「云端同步」就是骗人（PRD §14.2）"
    );

    /* ③ 同一份配置下：标签说本地、通知正文说云端。两句各说一件事（状态 vs 动作），不打架；
       标题该取哪个常量见下面那条挂起用例。 */
    assert_eq!(
        blocked_notice(&not_filled).map(|(_, body)| body),
        Some(V0118_BODY),
        "未填全档的正文必须逐字"
    );

    /* ④ 开了 + 填全了 → 标签云端，且不再插话（这一下会真的跑） */
    store(&pool, &cfg_of(true, Some(webdav_filled()))).await;
    assert_eq!(sync_label(&pool).await, CLOUD_LABEL, "填全时标签必须是云端");
    assert!(blocked_notice(&not_filled).is_some(), "未填全档确实会说话");
}

/// **决议已落地**（原先挂着一个 `ignore` 标记等主理人拍板）：判据胜，改的是代码。
///
/// 判据说（§14.2 · B4 修订，原文逐字）：
/// > ① 菜单项标签仍逐字 `Markdown 同步`（因为未填全 → 不生效，标签诚实）；
/// > ② 点它 → 系统通知**标题** `Markdown 同步`、**正文**逐字 `先在设置里填好云端`
///
/// 改之前实现给的是 `CLOUD_LABEL`（`云端同步`），而同一份配置下菜单项写着 `Markdown 同步`
/// ——「点的是这个、弹的是那个」。决议：**通知标题必须与用户刚刚点的那一项标签逐字相同**，
/// 于是 `blocked_notice` 的那一档从 `CLOUD_LABEL` 改成 `LOCAL_LABEL`。
///
/// 断言刻意不写字面量：直接拿同一个库里 `sync_label` 的结果比 `blocked_notice` 的标题。
/// 这样「两处各抄一份文案」的实现会红，「共用同一个常量」的实现会绿 —— 这条比字面量断言强，
/// 所以它值得从「挂起」转正。
#[tokio::test]
async fn qa_b4_notice_title_should_equal_the_menu_item_label() {
    let pool = fresh_pool("qa-blocked-title").await;
    let not_filled = cfg_of(
        true,
        Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            ..MdSyncCloud::default()
        }),
    );
    store(&pool, &not_filled).await;

    let menu_label = sync_label(&pool).await;
    let notice_title = blocked_notice(&not_filled).expect("未填全必须有话说").0;
    assert_eq!(
        notice_title, menu_label,
        "点了写着「{menu_label}」的那一项，通知标题却是「{notice_title}」——用户会以为点错了东西"
    );
}

/* ===== 不变量：通知标题 ≡ 用户刚点的那一项的文字 ===== */

/// 配置空间的笛卡尔积：`enabled`（2）× 老形状 `cloud`（9）× 新双通路 3×3（18）。
///
/// **这不是手抄一遍档位清单。** 它读的字段只有总开关、两条通路各自「有没有 / 开没开 /
/// 填没填全」，把这些维度枚举成交叉积，将来在同一组字段上新增一档会自动落在某个格子里
/// 被断言。**唯一需要维护的情形**：出现了不在这几个维度上的新判据（按时间、按网络状态、
/// 按上次失败次数……），那时把那个维度加进来；除此之外新增档位零维护。
fn config_space() -> Vec<(String, MdSyncConfig)> {
    let blank_webdav = || MdSyncCloud { enabled: true, mode: CloudMode::Webdav, ..MdSyncCloud::default() };
    let cleared = |f: fn(&mut MdSyncCloud)| {
        let mut cloud = webdav_filled();
        f(&mut cloud);
        cloud
    };

    let clouds: Vec<(String, Option<MdSyncCloud>)> = vec![
        ("cloud=None（从没配过）".into(), None),
        (
            "选了「只用本地」（字段全在、cloud.enabled=false）".into(),
            Some(MdSyncCloud {
                enabled: false,
                ..webdav_filled()
            }),
        ),
        ("webdav 三项全空".into(), Some(blank_webdav())),
        ("webdav 只缺 baseUrl".into(), Some(cleared(|c| c.base_url.clear()))),
        ("webdav 只缺 basePath".into(), Some(cleared(|c| c.base_path.clear()))),
        ("webdav 只缺 user".into(), Some(cleared(|c| c.user.clear()))),
        ("webdav 填全".into(), Some(webdav_filled())),
        (
            "localfolder 没选落点目录".into(),
            Some(MdSyncCloud {
                enabled: true,
                mode: CloudMode::LocalFolder,
                ..MdSyncCloud::default()
            }),
        ),
        ("localfolder 填全".into(), Some(localfolder_filled())),
    ];

    let mut cells: Vec<(String, MdSyncConfig)> = Vec::with_capacity(clouds.len() * 2 + 12);
    for enabled in [false, true] {
        for (label, cloud) in &clouds {
            cells.push((format!("总开关={enabled} / {label}"), cfg_of(enabled, cloud.clone())));
        }
    }

    /* [V0.11.26] 新维度：**两条通路各自开不开**。老形状（二选一）永远造不出
       「folder 开 + webdav 开」这一格，而块④⑤ 两个独立开关正是这次改造的判据本体。
       每格三态（关 / 开但空 / 开且填全），两条通路交叉 = 3 × 3 × 总开关 2 = 18 格。 */
    let folder_of = |state: u8| match state {
        0 => None,
        1 => Some(md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            ..Default::default()
        }),
        _ => Some(md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            local_root: localfolder_filled().local_root.clone(),
            ..Default::default()
        }),
    };
    let webdav_of = |state: u8| match state {
        0 => None,
        1 => Some(md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            ..Default::default()
        }),
        _ => Some(md_sync_channel::MdSyncCloudChannel {
            enabled: true,
            base_url: "https://dav.jianguoyun.com/dav/".into(),
            base_path: "/Timing".into(),
            user: "me@example.com".into(),
            ..Default::default()
        }),
    };
    let names = ["关", "开但空", "开且填全"];
    for enabled in [false, true] {
        for (folder_state, folder_name) in names.iter().enumerate() {
            for (webdav_state, webdav_name) in names.iter().enumerate() {
                cells.push((
                    format!("总开关={enabled} / folder={folder_name} / webdav={webdav_name}"),
                    MdSyncConfig {
                        enabled,
                        cloud_folder: folder_of(folder_state as u8),
                        cloud_webdav: webdav_of(webdav_state as u8),
                        ..MdSyncConfig::default()
                    },
                ));
            }
        }
    }
    cells
}

/// **主判据（不变量）**：凡是会弹通知的格子，标题必须逐字等于同一份配置下菜单项的文字。
///
/// 这一条替代得上「把两档抄成两条例子」：交叉积里每个 `Some(..)` 的格子都被比一次，
/// 新增档位落在哪个格子里都会被它逮到。
#[tokio::test]
async fn qa_notice_title_always_equals_the_menu_item_label() {
    let pool = fresh_pool("qa-notice-invariant").await;
    let mut notice_cells = 0usize;

    for (name, cfg) in config_space() {
        /* 同一个池反复覆盖写：`sync_label` 每次现读配置，所以每格读到的都是本格的配置。 */
        store(&pool, &cfg).await;
        let menu = sync_label(&pool).await;

        if let Some((title, body)) = blocked_notice(&cfg) {
            notice_cells += 1;
            assert!(!body.trim().is_empty(), "格 {name}：给了标题却没给正文");
            assert_eq!(
                title, menu,
                "格 {name}：用户点的是写着「{menu}」的那一项，通知标题却是「{title}」——\
                 标题必须与刚点的那一项逐字相同（PRD §14.2 / 主理人裁决）"
            );
        }
    }

    /* 防空转：`blocked_notice` 哪天恒返回 None，上面一个格子都不会进，这条要红。 */
    assert!(notice_cells >= 2, "至少两档会弹通知，实际只有 {notice_cells} 档");
}

/// 反向：**不该插话**的档位连标题都不产生，也就没有「标题不符」可言。
///
/// 与上面那条合起来的完整意思是：`blocked_notice` 要么返回 `None`（无标题），
/// 要么返回一个**与菜单项文字相同**的标题——不存在第三种形态。
#[test]
fn qa_tiers_that_let_it_run_produce_no_title_at_all() {
    let cases: Vec<(&str, MdSyncConfig)> = vec![
        (
            "填全了（webdav）",
            MdSyncConfig {
                enabled: true,
                cloud: Some(webdav_filled()),
                ..MdSyncConfig::default()
            },
        ),
        (
            "填全了（localfolder）",
            MdSyncConfig {
                enabled: true,
                cloud: Some(localfolder_filled()),
                ..MdSyncConfig::default()
            },
        ),
        (
            "选了「只用本地」、字段全在",
            MdSyncConfig {
                enabled: true,
                cloud: Some(MdSyncCloud {
                    enabled: false,
                    ..webdav_filled()
                }),
                ..MdSyncConfig::default()
            },
        ),
        (
            "从没配过云端（cloud=None）",
            MdSyncConfig {
                enabled: true,
                cloud: None,
                ..MdSyncConfig::default()
            },
        ),
    ];

    for (name, cfg) in cases {
        assert_eq!(
            blocked_notice(&cfg),
            None,
            "档 {name}：这一下会真的跑，不该插话（插了就只能紧跟一条「完成」，两条通知互相拆台）"
        );
    }
}
