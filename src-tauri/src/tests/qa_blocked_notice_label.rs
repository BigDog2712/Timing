//! `blocked_notice` 的真库半场（PRD §14.2）：标签读生效通道、通知标题该取哪个常量。
//!
//! 拆成两个文件是因为「单文件 ≤300 行」硬门禁（ADR-017，零豁免）：`qa_blocked_notice.rs`
//! 放十档纯函数表，这里放需要真库的 `sync_label` 对照。夹具与常量从那边 `use` 过来，
//! **绝不复制**（复制一份 `webdav_filled` 就等于复制一份「填全」的定义，两处会漂）。
//!
//! ## 这一层管不到的（如实交代）
//!
//! `run_once` 里「命中就只弹这一条并 `return`」要 `AppHandle`（真托盘 + 真通知），单元层拿不到，
//! 只能静态核对：`tray_sync.rs` 那个分支体只有 `notify_or_log` + `return`，`return` 之后才是
//! `md_cloud::round`。所以「只弹一条、不紧跟一条完成/没有变更」形状上成立，但无自动化证据。

use sqlx::SqlitePool;

use super::qa_blocked_notice::{webdav_filled, V0118_BODY};
use crate::app::tray_sync::{blocked_notice, sync_label, CLOUD_LABEL, LOCAL_LABEL};
use crate::models::md_sync::MdSyncConfig;
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
    store(
        &pool,
        &MdSyncConfig {
            enabled: false,
            cloud: Some(webdav_filled()),
            ..MdSyncConfig::default()
        },
    )
    .await;
    assert_eq!(
        sync_label(&pool).await,
        LOCAL_LABEL,
        "总开关关着：不会跑云端，标签必须是「Markdown 同步」（`sync_label` 单独判了总开关）"
    );

    /* ② 开了 + 选了云端 + 没填全 → 标签回落本地（`usable()` 为 None） */
    let not_filled = MdSyncConfig {
        enabled: true,
        cloud: Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            ..MdSyncCloud::default()
        }),
        ..MdSyncConfig::default()
    };
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
    store(
        &pool,
        &MdSyncConfig {
            enabled: true,
            cloud: Some(webdav_filled()),
            ..MdSyncConfig::default()
        },
    )
    .await;
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
    let not_filled = MdSyncConfig {
        enabled: true,
        cloud: Some(MdSyncCloud {
            enabled: true,
            mode: CloudMode::Webdav,
            ..MdSyncCloud::default()
        }),
        ..MdSyncConfig::default()
    };
    store(&pool, &not_filled).await;

    let menu_label = sync_label(&pool).await;
    let notice_title = blocked_notice(&not_filled).expect("未填全必须有话说").0;
    assert_eq!(
        notice_title, menu_label,
        "点了写着「{menu_label}」的那一项，通知标题却是「{notice_title}」——用户会以为点错了东西"
    );
}

