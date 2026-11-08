//! 便携落点（V0.11.6）**独立验收** · D 组（md 落点与老配置）。
//!
//! 三条守门人：
//! - **D12** 未注入 `app_dir` 时 `%APP_DIR%\md` 必须给**绝对路径**，不许漏占位符、
//!   不许在 CWD 长出目录树（`resolve_path` 会拿它 `create_dir_all`）。
//! - **D13** 老用户保存的 root 不许被默认值覆盖（静默丢配置是最难查的一类）。
//! - **D14** `enabled` 的 `Default` 与 `#[serde(default)]` 必须同口径（都 false）。

use std::path::Path;

use crate::infra::db;
use crate::models::md_sync::{MdSyncBinding, MdSyncKind};
use crate::models::md_sync_config::{MdSyncConfig, MD_SYNC_DEFAULT_ROOT};
use crate::repositories::settings;
use crate::services::md_sync::config as md_config;

use super::portable_dir_qa::temp;

/// D12：默认根的展开结果。
#[test]
fn d12_default_root_expands_to_absolute_path_without_side_effects() {
    assert_eq!(MD_SYNC_DEFAULT_ROOT, r"%APP_DIR%\md", "占位符是唯一口径");

    let got = crate::infra::md_file::expand_env(MD_SYNC_DEFAULT_ROOT);
    assert!(!got.contains('%'), "不许漏出占位符：{got}");
    assert!(
        Path::new(&got).is_absolute(),
        "未注入 app_dir 时也必须给绝对路径（否则 resolve_path 会在 CWD 造目录树）：{got}"
    );
    assert_eq!(
        got,
        crate::platform::app_dir::fallback_appdata()
            .join("md")
            .to_string_lossy(),
        "未注入时应落在兜底 AppData 数据根之下"
    );
    assert!(
        !Path::new("%APP_DIR%").exists(),
        "CWD 里不许长出叫 %APP_DIR% 的目录树"
    );

    /* `%APP_DIR%` 必须先于 `%VAR%`：即便机器上真有一个叫 APP_DIR 的环境变量，
    也不许被劫持。（本进程内无法设环境变量给并行用例看，故只固化「不含 %」+ 绝对路径
    两条可机械判定的部分。） */
    let via_resolve = crate::infra::md_file::resolve_path(
        MD_SYNC_DEFAULT_ROOT,
        "{date}.md",
        chrono::NaiveDate::from_ymd_opt(2026, 11, 6).expect("日期"),
    );
    assert!(
        via_resolve.is_absolute(),
        "resolve_path 结果必须绝对：{via_resolve:?}"
    );
}

/// D14：`Default::default().enabled == false`，且缺字段时 serde 也补 false。
#[test]
fn d14_default_is_disabled_and_serde_defaults_to_false() {
    let from_default = MdSyncConfig::default();
    assert!(
        !from_default.enabled,
        "出厂默认必须关（升级不该自己开始写盘）"
    );
    assert_eq!(from_default.bindings.len(), 3, "三档落点");

    /* 老 JSON 缺 `enabled`：必须补 false（不是 `default_true`）。 */
    let parsed: MdSyncConfig =
        serde_json::from_str(r#"{"pollSecs":900}"#).expect("老 JSON 应可解析");
    assert!(!parsed.enabled, "缺字段时按 false 补");
    assert_eq!(parsed.poll_secs, 900, "缺 pollSecs 才用默认");
    assert!(parsed.bindings.is_empty(), "缺 bindings 补空，由 load 合并");
}

/// D13：老用户的 `D:\MyVault` 原样保留，只把缺的 kind 补上（用新默认根）。
#[tokio::test]
async fn d13_saved_root_and_heading_survive_only_missing_kind_is_appended() {
    let dir = temp("qa-d13");
    let pool = db::init_pool(&dir).await.expect("init_pool");
    let old = MdSyncConfig {
        cloud: None,
        enabled: true,
        poll_secs: 900,
        bindings: vec![
            MdSyncBinding {
                kind: MdSyncKind::Timers,
                enabled: true,
                root: r"D:\MyVault".into(),
                file: "{date}.md".into(),
                heading: "#### 我改过的计时".into(),
            },
            MdSyncBinding {
                kind: MdSyncKind::Notes,
                enabled: true,
                root: r"D:\MyVault".into(),
                file: "{date}.md".into(),
                heading: "#### 便利贴".into(),
            },
        ],
        ..MdSyncConfig::default()
    };
    let raw = serde_json::to_string(&old).expect("序列化");
    settings::set_value(&pool, md_config::CONFIG_KEY, &raw, 1)
        .await
        .expect("写老配置");

    let loaded = md_config::load(&pool).await.expect("load 应成功");
    pool.close().await;

    assert_eq!(loaded.bindings.len(), 3, "todos 应被补齐");
    assert_eq!(loaded.bindings[0].root, r"D:\MyVault", "老 root 不许被覆盖");
    assert_eq!(
        loaded.bindings[0].heading, "#### 我改过的计时",
        "老标题不许被覆盖"
    );
    assert_eq!(loaded.bindings[1].root, r"D:\MyVault");
    assert_eq!(loaded.bindings[2].kind, MdSyncKind::Todos, "补的是第三种");
    assert_eq!(
        loaded.bindings[2].root, MD_SYNC_DEFAULT_ROOT,
        "补进来的落点用新默认根"
    );
    assert!(loaded.enabled, "老用户存过 true 就还是 true");
}
