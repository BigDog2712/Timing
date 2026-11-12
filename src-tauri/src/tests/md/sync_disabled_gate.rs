//! 出厂默认「关」到底关到哪一层：md 同步内核化（V0.11.5）。
//!
//! 内核化时把出厂默认改成了 `enabled = false`（同步会往用户磁盘写文件，不该在一次
//! 升级后自己开始写）。这里验的不是界面上那个开关的**样子**，而是它**关到什么深度**：
//!
//! 1. 全新用户 `config::load` 拿到的就是 `Default::default()`，三档落点齐全、总开关关；
//! 2. `sync_all` 的闸门在逐落点循环**之前**（`services/md_sync/mod.rs` 里
//!    `if !config.enabled { ... return Ok(report) }`），所以循环体里的
//!    `md_file::resolve_path` / `read_section` / `write_section` 一次都不会执行；
//! 3. 序列化边界：老 JSON 缺 `enabled` 字段时必须反序列化成 `false`（与 `Default` 同口径）。
//!
//! 「不产生文件 IO」这件事没法用 spy 直接断言（`std::fs` 没有可注入的抽象），
//! 所以用两条**可观测**的等价证据：
//!   - 落点根目录指向一个不存在的路径 → 跑完仍不存在（存在即证明循环跑过）；
//!   - 混入一档 `root = "%TIMING_QA_NO_SUCH_VAR%\nope"` → 若循环跑过，这一档必然进
//!     `report.errors`（「根目录无法解析为绝对路径」）；关闭状态下错误必须是空的。
//!
//! 本文件所有落点都指向临时目录，绝不碰 `%USERPROFILE%\Documents\Timing`。

use std::path::Path;

use chrono::Local;
use serde_json::json;

use crate::infra::md_file;
use crate::models::md_sync::{MdSyncBinding, MdSyncConfig, MdSyncKind};
use crate::models::md_sync_config::{MD_SYNC_DEFAULT_FILE, MD_SYNC_DEFAULT_ROOT};
use crate::repositories::settings;
use crate::services;
use crate::services::md_sync::config;
use crate::tests::support::{fresh_pool, unique_dir};

use super::sync::{binding, NOTES_HEADING, TIMERS_HEADING, TODOS_HEADING};

/// 库里根本没有 `plugin.md-sync.config` 这个键（全新安装 / 从没进过设置页）。
#[tokio::test]
async fn a_fresh_install_loads_the_disabled_kernel_default() {
    let pool = fresh_pool("md-kernel-fresh").await;

    /* 前提：键真的不存在（否则这个用例在验一个假场景）。 */
    assert_eq!(
        settings::get_value(&pool, config::CONFIG_KEY)
            .await
            .expect("读 KV 应成功"),
        None,
        "新库里不该有这个键"
    );

    let loaded = config::load(&pool).await.expect("应返回默认值");

    assert_eq!(
        loaded,
        MdSyncConfig::default(),
        "没有保存值时返回的就是 Default::default()"
    );
    assert!(
        !loaded.enabled,
        "出厂默认必须关：同步会往用户磁盘写文件，不该在一次升级后自己开始写"
    );
    assert_eq!(
        loaded
            .bindings
            .iter()
            .map(|item| item.kind)
            .collect::<Vec<_>>(),
        vec![MdSyncKind::Timers, MdSyncKind::Notes, MdSyncKind::Todos],
        "三档都要在，顺序与设置页渲染顺序一致"
    );
    for item in &loaded.bindings {
        assert_eq!(item.root, MD_SYNC_DEFAULT_ROOT, "落点根目录为内核默认值");
        assert_eq!(item.file, MD_SYNC_DEFAULT_FILE, "一天一个文件");
        assert!(item.enabled, "单档默认开启，总开关才是关的那一个");
    }
}

/// 老库里的 JSON **没有** `enabled` 字段时，反序列化必须是 `false`。
///
/// 这条决定「口径分叉」有没有被堵上：`MdSyncConfig` 的 `Default` 是 `false`，
/// 若字段上挂的是 `#[serde(default = "default_true")]`，同一个字段就会有两套默认值——
/// `Default::default()` 说关、`from_str` 说开，取决于用户是「没存过」还是
/// 「存过但没有这个字段」，后者正是升级用户。
///
/// 对照断言（同一组里的另一半口径）：`MdSyncBinding.enabled` **缺省是 true**。
/// 两者相反是刻意的——总开关关闭是安全默认，单档开启是功能默认（落点存在即参与）。
/// 把这条也钉住，防止后来人「统一一下默认值」时把其中一边改错。
#[test]
fn a_missing_enabled_field_deserializes_to_false() {
    let raw = json!({ "pollSecs": 900, "bindings": [] }).to_string();
    let parsed: MdSyncConfig = serde_json::from_str(&raw).expect("缺字段的老 JSON 不该解析失败");

    assert!(
        !parsed.enabled,
        "缺 enabled 时必须按 false 补，否则升级用户会被判成「已开启同步」"
    );
    assert!(
        !MdSyncConfig::default().enabled,
        "Default 必须同口径：两条路径都指向 false"
    );

    /* 反向对照：bindings 里的 enabled 缺省是 true（落点存在即参与同步）。 */
    let binding_only: MdSyncBinding = serde_json::from_str(&json!({ "kind": "todos" }).to_string())
        .expect("落点缺字段也应能解析");
    assert!(
        binding_only.enabled,
        "单档 enabled 缺省为 true —— 与总开关相反是刻意的，别「统一」掉"
    );
}

/// 关闭状态下跑一轮同步：不写文件、不读文件、连落点目录都不建。
#[tokio::test]
async fn a_disabled_config_performs_no_file_io() {
    let pool = fresh_pool("md-kernel-gate").await;
    let vault = unique_dir("md-kernel-gate-vault");
    assert!(!vault.exists(), "前提：落点目录本来不存在");

    let mut trap = binding(MdSyncKind::Todos, &vault, "{date}.md", TODOS_HEADING);
    /* 未知环境变量会被原样保留 → 不是绝对路径 → 循环若执行就必然报错。 */
    trap.root = r"%TIMING_QA_NO_SUCH_VAR%\nope".into();

    config::save(
        &pool,
        &MdSyncConfig {
            cloud: None,
            enabled: false,
            poll_secs: 900,
            bindings: vec![
                binding(MdSyncKind::Timers, &vault, "{date}.md", TIMERS_HEADING),
                binding(MdSyncKind::Notes, &vault, "{date}.md", NOTES_HEADING),
                trap,
            ],
        ..MdSyncConfig::default() },
    )
    .await
    .expect("关闭状态本身是合法配置");

    let report = services::md_sync::run(&pool)
        .await
        .expect("关闭时同步也不该报错");

    assert_eq!(report.exported, 0, "关闭状态不写任何落点");
    assert_eq!(report.imported, 0, "关闭状态不读任何落点");
    assert!(
        report.errors.is_empty(),
        "闸门在循环之前：连「根目录解析失败」都不该出现，实际 {:?}",
        report.errors
    );
    assert!(
        !vault.exists(),
        "关闭状态连落点目录都不该被创建 —— 存在即说明循环跑过"
    );
}

/// 全新用户（没有保存值 = 内核默认关）跑一次同步，不能碰用户文档目录。
///
/// 端到端验证：V0.11.6 起默认根是 `%APP_DIR%\md`（解析到数据目录下的 `md\`，
/// 桌面版即 `<exe>\data\md`；V0.11.5 及以前是 `%USERPROFILE%\Documents\Timing`）。
/// 若闸门失效，第一次 tick 就会在那个目录里建出 `<今天的日期>.md`。断言用
/// 「存在性不变」而不是「不存在」——机器上恰好已有这个目录时仍能安全通过。
///
/// 用例名里的 `real_documents_dir` 是 V0.11.5 的措辞，保留是为了不动作例清单；
/// 判据（存在性不变）与默认根改名无关，仍成立。
///
/// **为什么文件那条也要比前后指纹，而不是「必须不存在」**：本机跑过 App 之后，
/// 这个真实路径下本来就有今天的 `<日期>.md`（App 正常同步写的）。绝对断言
/// `!default_file.exists()` 于是只在「从没启动过 App 的干净机器」上成立，一用过就必红
/// —— 那不是回归，是判据把用户的真实数据当成了违规。改成「存在性 + 长度 + 修改时刻」
/// 前后不变：既有能力抓「同步偷偷建了 / 覆写了今天这份」，又不再依赖机器干净。
#[tokio::test]
async fn a_fresh_install_sync_writes_nothing_to_the_real_documents_dir() {
    let pool = fresh_pool("md-kernel-fresh-run").await;

    let today = Local::now().date_naive();
    let default_file = md_file::resolve_path(MD_SYNC_DEFAULT_ROOT, MD_SYNC_DEFAULT_FILE, today);
    let default_dir = default_file.parent().map(Path::to_path_buf);
    let existed_before = default_dir.as_deref().is_some_and(Path::exists);
    let fingerprint_before = file_fingerprint(&default_file);

    let report = services::md_sync::run(&pool)
        .await
        .expect("默认关时同步应无错");

    assert_eq!(report.exported, 0);
    assert!(report.errors.is_empty(), "{:?}", report.errors);
    assert_eq!(
        existed_before,
        default_dir.as_deref().is_some_and(Path::exists),
        "默认关却动了用户文档目录：{}",
        default_dir.map_or_else(|| "?".into(), |dir| dir.display().to_string())
    );
    assert_eq!(
        fingerprint_before,
        file_fingerprint(&default_file),
        "默认关却写/改了今日文件：{}",
        default_file.display()
    );
}

/// 文件指纹：`None` = 不存在；`Some((长度, 修改时刻))` = 存在时的可观测状态。
///
/// 只比「长度 + 修改时刻」，不比内容：这条用例要抓的是「有没有写」，不是「写了什么」；
/// 读全文会在文件很大时拖慢测试，且一旦文件被写到不同内容也会落在长度或时刻的差异上。
fn file_fingerprint(path: &Path) -> Option<(u64, Option<std::time::SystemTime>)> {
    let meta = std::fs::metadata(path).ok()?;
    Some((meta.len(), meta.modified().ok()))
}
