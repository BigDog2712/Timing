//! 托盘同步项的文案 + 「退出前跑一轮」（V0.11.18，PRD TR1 / TR2a / §13.3）。
//!
//! ## 为什么不在 `app/tray_sync.rs` 的 `mod tests` 里
//!
//! 这里两条判据都要**一个真库 + 一个真临时落点**，而 `tests/support` 的夹具只对 `tests`
//! 子树可见（`mod support;` 是私有的）。**绝不因此复制一套**：`md_sync::env` 里那段
//! 「每个用例开跑前先把三种 kind 一次锁到临时目录」是安全底线（V0.4.0 出过一次「一次 run
//! 写进作者本机日记」的事故），两套夹具意味着有一天会漏掉一套。
//!
//! ## 判据要说什么
//!
//! - `sync_label` 读的是**生效通道**（`md_cloud::usable`），不是 `cloud.enabled`：
//!   「选了本地 + 云端但没填全」时云端根本不会跑，此时写「云端同步」是骗人（PRD TR2）；
//! - `run_before_quit` 在**总开关关着**时立刻返回 `false`（= 不等，PRD §13.3.1「白等 3 秒
//!   是纯损失」），开着时真的跑一轮（TR2a 的单元层证据；原生菜单那一层要人点，见交付报告）。

use sqlx::SqlitePool;

use super::md_sync::{at, env};
/* `run_before_quit` 与 `QUIT_SYNC_BUDGET` 在 `app/tray_quit.rs`（[V0.11.18] 为行数门禁拆出），
`sync_label` / `try_acquire` 留在 `app/tray_sync.rs`：闸的 `Drop` 语义只该有一处定义。 */
use crate::app::tray_quit::run_before_quit;
use crate::app::tray_sync::{blocked_notice, sync_label, LOCAL_LABEL};
use crate::models::md_sync::MdSyncConfig;
use crate::models::md_sync_cloud::{CloudMode, MdSyncCloud};
use crate::repositories::settings;
use crate::services::md_sync::config;
use crate::tests::support::{insert_saved, new_item, unique_dir};

/// 直接写 `settings` 表，**绕过 `config::validate`**。
///
/// 判据里有「`enabled: true` 但地址是空的」这一档，而 `validate_webdav` 会拒绝它
/// （`请填写 WebDAV 服务地址`）。那一档在真机上确实存在：用户先开通道、地址留空，
/// 界面上「云端还没填全，暂时不会同步」说的就是它。用夹具直接落库才是这一档的真形状。
async fn store(pool: &SqlitePool, config: &MdSyncConfig) {
    let raw = serde_json::to_string(config).expect("配置应能序列化");
    settings::set_value(pool, config::CONFIG_KEY, &raw, 0)
        .await
        .expect("写 settings 应成功");
}

/// TR1b 第 1 档：`cloud = null`（从没配过云端）→ 「Markdown 同步」。
///
/// `env()` 预置的就是这一档（`cloud: None`），所以这里不写配置。
#[tokio::test]
async fn sync_label_is_local_when_cloud_never_configured() {
    let env = env("tray-label-none").await;
    assert_eq!(
        sync_label(&env.pool).await,
        "Markdown 同步",
        "从没配过云端的人，同步项必须逐字沿用老文案（PRD TR3：老用户零变化）"
    );
}

/// TR1b 第 2 档：`enabled: true` 且填全了 → 「云端同步」。
#[tokio::test]
async fn sync_label_is_cloud_when_channel_is_usable() {
    let env = env("tray-label-usable").await;
    let root = unique_dir("tray-cloud-root");
    std::fs::create_dir_all(&root).unwrap();
    let mut current = config::load(&env.pool).await.unwrap();
    current.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::LocalFolder,
        local_root: root.display().to_string(),
        ..MdSyncCloud::default()
    });
    store(&env.pool, &current).await;

    assert_eq!(sync_label(&env.pool).await, "云端同步");
}

/// TR1b 第 3 档：**选了本地 + 云端但没填全** → 仍说「Markdown 同步」。
///
/// 这是对「标签随通道变」的有意偏离，也是最容易被当成 bug 报上来的一条：此刻
/// `cloud.enabled === true`（界面上选中「本地 + 云端」），但 `is_usable()` 为假 →
/// `md_cloud::usable()` 返回 `None` → `round()` 逐字转交 `md_sync::run`（纯本地）。
/// 标签必须说真话：点下去只有本地那一半在动（PRD TR2「先在设置里填好云端」）。
#[tokio::test]
async fn sync_label_stays_local_when_selected_but_not_filled() {
    let env = env("tray-label-half").await;
    let mut current = config::load(&env.pool).await.unwrap();
    current.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: String::new(),
        base_path: "/Timing".into(),
        user: String::new(),
        ..MdSyncCloud::default()
    });
    store(&env.pool, &current).await;

    assert_eq!(
        sync_label(&env.pool).await,
        "Markdown 同步",
        "云端不会真的跑一轮，标签不能写成「云端同步」"
    );
}

/// TR1b 第 4 档：`enabled: false`（配过、但现在只用本地）→ 「Markdown 同步」。
#[tokio::test]
async fn sync_label_is_local_when_channel_off() {
    let env = env("tray-label-off").await;
    let mut current = config::load(&env.pool).await.unwrap();
    /* 地址 / 目录 / 账号**都留着**，只把通道关掉（CH4：切回即恢复） */
    current.cloud = Some(MdSyncCloud {
        enabled: false,
        mode: CloudMode::Webdav,
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        ..MdSyncCloud::default()
    });
    store(&env.pool, &current).await;

    assert_eq!(sync_label(&env.pool).await, "Markdown 同步");
}

/// [V0.11.18] 第 5 档：**总开关关着、但云端字段全都填好了** → 仍然说「Markdown 同步」。
///
/// 这一档是「标签说假话」的第二个入口，和「未填全」那条同病：
/// `md_cloud::usable()` **不看顶层 `config.enabled`**（它只判 `cloud.enabled && is_usable()`），
/// 所以不单独判一次的话，托盘会写着「云端同步」——而点下去弹的是
/// 「先在设置里打开 Markdown 同步」。用户点的是「云端同步」那四个字，得到的回应却在说
/// 另一个开关，他没法把这两件事连起来。
///
/// 修法只在 `sync_label` 里加一层，**不动 `usable()`**：它还服务 `round` / 轮询 /
/// 手机端 / 备份四处，改语义要一起承担。
#[tokio::test]
async fn sync_label_is_local_when_master_switch_is_off_even_if_cloud_is_filled() {
    let env = env("tray-label-off-filled").await;
    let mut current = config::load(&env.pool).await.unwrap();
    current.enabled = false;
    /* 字段一个不少（`is_usable() == true`），只有总开关关着 */
    current.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        ..MdSyncCloud::default()
    });
    store(&env.pool, &current).await;

    assert_eq!(
        sync_label(&env.pool).await,
        "Markdown 同步",
        "总开关关着时这一轮连 md_sync::run 都不会进，写「云端同步」就是假话"
    );
}

/// PRD §13.3.1「同步未启用 → 不跑、不等，直接退出」。
///
/// 返回值就是「要不要等」的那个信号：`false` = 没有要写的东西。
#[tokio::test]
async fn run_before_quit_returns_immediately_when_sync_disabled() {
    let env = env("tray-quit-off").await;
    let mut current = config::load(&env.pool).await.unwrap();
    current.enabled = false;
    store(&env.pool, &current).await;

    assert!(!run_before_quit(&env.pool).await, "总开关关着不该跑一轮");
    /* 真的一行都没写：连落点目录都不该被建出来 */
    let file = env.vault.join(format!("{}.md", env.date.format("%Y-%m-%d")));
    assert!(!file.exists());
}

/// TR2a 的单元层证据：总开关开着时，退出前那一轮真的把数据写进了文件。
///
/// 原生菜单「点退出 → 先同步 → 进程消失」那一段要人点托盘才看得到（见交付报告「未验证」）。
#[tokio::test]
async fn run_before_quit_writes_before_exit_when_enabled() {
    let env = env("tray-quit-on").await;
    let item = new_item(&env.pool, "收尾写盘").await;
    insert_saved(&env.pool, item, at(env.date, 9, 0), at(env.date, 9, 30), 1800).await;

    assert!(run_before_quit(&env.pool).await, "开着就该跑一轮");
    let text = std::fs::read_to_string(env.vault.join(format!("{}.md", env.date.format("%Y-%m-%d"))))
        .expect("退出前那一轮应写出今日文件");
    assert!(text.contains("收尾写盘"));
}

/* ===== [V0.11.18] B4：点了「同步」之后才知道云端没填全 ===== */

/// 填全了的一份 `cloud`（`webdav` 三件套都在）——判据的「对照档」。
fn filled_webdav() -> MdSyncCloud {
    MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        base_url: "https://dav.jianguoyun.com/dav/".into(),
        base_path: "/Timing".into(),
        user: "me@example.com".into(),
        ..MdSyncCloud::default()
    }
}

/// TR2 / B4：四档一次钉住（纯函数，不落库、不发通知）。
///
/// 为什么这条与 `sync_label` 的判据并存而不是二选一：标签读**生效通道**
/// （`enabled && is_usable()`），未填全时菜单项显示 `Markdown 同步` —— 所以
/// 「点『云端同步』→ 提示先在设置里填好云端」这一帧**永远不会发生**。两条判据各自成立：
/// 标签管「点之前知道会发生什么」，这条管「点了之后知道为什么只写了一半」。
#[test]
fn blocked_notice_covers_off_and_not_filled() {
    /* ① 总开关关着（出厂默认）→ 告诉他去哪儿开，正文逐字沿用 v0.11.7 */
    let mut config = MdSyncConfig::default();
    assert_eq!(
        blocked_notice(&config),
        Some(("Markdown 同步", "先在设置里打开 Markdown 同步"))
    );

    /* ② 开着 + 选了「本地 + 云端」但地址 / 目录 / 账号全空
          → 正文逐字 `先在设置里填好云端`；**标题是 `LOCAL_LABEL`**——
          用户点的那一项此刻就写着「Markdown 同步」（未填全 → `sync_label` 也返回它），
          通知标题若写「云端同步」就是另一句假话。 */
    config.enabled = true;
    config.cloud = Some(MdSyncCloud {
        enabled: true,
        mode: CloudMode::Webdav,
        ..MdSyncCloud::default()
    });
    assert_eq!(blocked_notice(&config), Some((LOCAL_LABEL, "先在设置里填好云端")));

    /* ③ 只填了两个字段也不算填全（`is_usable` 要求三个都非空）——这一档最容易写漏 */
    config.cloud = Some(MdSyncCloud {
        user: String::new(),
        ..filled_webdav()
    });
    assert_eq!(blocked_notice(&config), Some((LOCAL_LABEL, "先在设置里填好云端")));

    /* ④ 填全了 → 不再插话，这一下会真的跑 */
    config.cloud = Some(filled_webdav());
    assert_eq!(blocked_notice(&config), None);

    /* ⑤ 只用本地（字段都留着、`enabled: false`）→ 一句都不用说 */
    config.cloud = Some(MdSyncCloud {
        enabled: false,
        ..filled_webdav()
    });
    assert_eq!(blocked_notice(&config), None);

    /* ⑥ 从没配过云端（`cloud: None`）→ 同样是纯本地，不插话 */
    config.cloud = None;
    assert_eq!(blocked_notice(&config), None);
}
