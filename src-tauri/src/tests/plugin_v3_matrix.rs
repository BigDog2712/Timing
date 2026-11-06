//! 插件 API v3 兼容矩阵（V0.11.5）：四个真实清单逐个过读盘 + 列表。
//!
//! | 清单 | 期望 |
//! |---|---|
//! | v1 只写 `quickTimers` | 载入、生效、`warnings` 为空 |
//! | v2 写了 `contributes.mdSync` | **仍生效**、`warnings` 非空（黄字警告） |
//! | `apiVersion: 4` | 拒载，原因说明版本过高 |
//! | `entry: "script"` | 拒载，原因说明运行时未提供 |
//!
//! 为什么写真实文件而不是直接构造 `PluginManifest`：camelCase 映射、
//! `#[serde(default)]`、`EntryKind` 的 lowercase 解析，全都是
//! 「作者写出来的字符串 → 宿主理解的字段」这一段。直接构造结构体等于跳过被测的那一层。
//!
//! 清单一律落盘成 `plugin.json` 文本（`json!` 序列化，避免标题里的 `####` 终止
//! `r#"…"#` 原始字符串）。四条用例都把实际输出打到 stdout
//! （`cargo test -- --nocapture` 可见）。
//!
//! 文案**逐字**一致性在 `plugin_v3_wording.rs` 里单独验（那边用内联清单，不碰磁盘）。

use std::path::{Path, PathBuf};

use serde_json::json;

use crate::infra::plugin_fs;
use crate::models::plugin::{PluginInfo, PluginListResult, PLUGIN_API_VERSION};
use crate::services::plugin;

use crate::tests::support::unique_dir;

fn app_root(tag: &str) -> PathBuf {
    let root = unique_dir(tag);
    std::fs::create_dir_all(root.join("plugins")).unwrap();
    root
}

fn write_plugin(app_root: &Path, folder: &str, manifest: &serde_json::Value) -> PathBuf {
    let dir = app_root.join("plugins").join(folder);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("plugin.json"),
        serde_json::to_string_pretty(manifest).unwrap(),
    )
    .unwrap();
    dir
}

/// 从 `plugin_list` 的结果里取一个插件；拿不到就把整张表打出来，便于定位。
fn row(root: &Path, id: &str) -> PluginInfo {
    let result: PluginListResult = plugin::list(root);
    result
        .plugins
        .iter()
        .find(|item| item.id == id)
        .unwrap_or_else(|| panic!("没扫到 {id}，实际：{:?}", ids(&result)))
        .clone()
}

fn ids(result: &PluginListResult) -> Vec<String> {
    result
        .plugins
        .iter()
        .map(|item| format!("{}（{}）", item.id, item.source))
        .collect()
}

/// v1 只写 `quickTimers`：正常加载、生效、无警告。
#[test]
fn v1_quick_timers_only_loads_clean() {
    let root = app_root("plugin-v3-v1");
    let dir = write_plugin(
        &root,
        "v1-kit",
        &json!({
            "id": "v1-kit",
            "name": "v1 快捷计时",
            "version": "1.0.0",
            "apiVersion": 1,
            "contributes": { "quickTimers": [ { "item": "喝水", "minutes": 3 } ] },
        }),
    );

    let (manifest, warnings) = plugin_fs::read_manifest(&dir).expect("v1 清单应能载入");
    let info = row(&root, "v1-kit");

    println!(
        "[v1] read_manifest → apiVersion={} entry={:?} warnings={:?}",
        manifest.api_version, manifest.entry, warnings
    );
    println!(
        "[v1] list → enabled={} error={:?} warnings={:?} quickTimers={:?}",
        info.enabled, info.error, info.warnings, info.quick_timers
    );

    assert_eq!(manifest.api_version, 1);
    assert_eq!(warnings, Vec::<String>::new(), "v1 清单没有被忽略的字段");
    assert!(info.enabled, "v1 插件照常生效");
    assert!(info.error.is_none());
    assert_eq!(
        info.warnings,
        Vec::<String>::new(),
        "没有 mdSync 就没有黄字"
    );
    assert_eq!(info.quick_timers.len(), 1);
    assert_eq!(info.quick_timers[0].minutes, 3);

    std::fs::remove_dir_all(&root).ok();
}

/// v2 写了 `contributes.mdSync`：**不校验、不拒载**，但要看见它并给一条警告。
///
/// 顺带钉住 `docs/plugin-spec.md` §10.8 那四条理由里的第 1、2 条：同一份清单里的
/// `quickTimers` 必须照常生效（「为一个作废的贡献点惩罚插件的全部功能」正是要避免的事）。
#[test]
fn v2_manifest_with_md_sync_still_works_with_a_warning() {
    let root = app_root("plugin-v3-v2");
    let dir = write_plugin(
        &root,
        "old-md-sync",
        &json!({
            "id": "old-md-sync",
            "name": "旧同步插件",
            "version": "2.0.0",
            "apiVersion": 2,
            "contributes": {
                "quickTimers": [ { "item": "摸鱼", "minutes": 25 } ],
                "mdSync": {
                    "enabled": true,
                    "pollSecs": 900,
                    "bindings": [ {
                        "kind": "timers",
                        "enabled": true,
                        "root": r"D:\MyVault",
                        "file": "{date}.md",
                        "heading": "#### 事项计时"
                    } ]
                }
            },
        }),
    );

    let (manifest, warnings) = plugin_fs::read_manifest(&dir).expect("v2 清单不该被拒载");

    println!(
        "[v2] read_manifest → apiVersion={} warnings（{} 条）={:?}",
        manifest.api_version,
        warnings.len(),
        warnings
    );

    /* mdSync 的**内容**不被解析：类型是 Value，所以只要它「存在」就够了。 */
    assert!(manifest.contributes.md_sync.is_some(), "字段要能看见存在");
    assert_eq!(warnings.len(), 1, "一条警告，不多不少：{warnings:?}");
    /* 逐字比对在 plugin_v3_wording.rs；这里只保证不是一句随便的提示。 */
    assert!(warnings[0].contains("mdSync"), "{warnings:?}");
    assert!(warnings[0].contains("设置 → 同步"), "要指路：{warnings:?}");

    let info = row(&root, "old-md-sync");
    println!(
        "[v2] list → enabled={} error={:?} warnings={:?} quickTimers={:?}",
        info.enabled, info.error, info.warnings, info.quick_timers
    );

    assert!(info.error.is_none(), "warnings 不是 error：不该标红");
    assert!(info.enabled, "插件仍生效（黄字，不是拒载）");
    assert_eq!(info.warnings.len(), 1);
    assert_eq!(
        info.quick_timers.len(),
        1,
        "同一份清单里的 quickTimers 必须照常贡献"
    );
    assert_eq!(info.quick_timers[0].minutes, 25);

    /* 快捷计时真的进了菜单（合并底座 = 出厂三条 + 本插件同名覆盖）。 */
    let result = plugin::list(&root);
    assert!(
        result.quick_timers.iter().any(|quick| quick.item == "摸鱼"),
        "被警告的插件仍要贡献菜单项"
    );

    std::fs::remove_dir_all(&root).ok();
}

/// `apiVersion: 4`：拒载，原因说明版本过高（且不能静默消失）。
#[test]
fn a_future_api_version_is_refused_with_a_reason() {
    let root = app_root("plugin-v3-v4");
    let dir = write_plugin(
        &root,
        "from-the-future",
        &json!({
            "id": "from-the-future",
            "name": "未来插件",
            "version": "4.0.0",
            "apiVersion": 4,
            "contributes": { "quickTimers": [ { "item": "喝水", "minutes": 3 } ] },
        }),
    );

    let err = plugin_fs::read_manifest(&dir).expect_err("apiVersion 4 必须拒载");
    println!("[v4] read_manifest → Err({err})");

    assert!(
        err.contains(&format!("1..={PLUGIN_API_VERSION}")),
        "原因要写清宿主支持的上界：{err}"
    );
    assert!(
        err.contains("本机宿主版本更低"),
        "原因要说明是宿主太低、不是插件写错：{err}"
    );

    /* 解析失败也要出现在列表里并带原因：静默跳过等于让用户对着文件夹抓狂。 */
    let info = row(&root, "invalid:from-the-future");
    println!(
        "[v4] list → id={} enabled={} error={:?}",
        info.id, info.enabled, info.error
    );
    assert!(!info.enabled);
    assert_eq!(info.error.as_deref(), Some(err.as_str()));
    assert!(info.quick_timers.is_empty(), "拒载的插件不贡献任何东西");

    std::fs::remove_dir_all(&root).ok();
}

/// `entry: "script"`：拒载，原因说明运行时未提供。
#[test]
fn a_script_entry_is_refused_with_a_reason() {
    let root = app_root("plugin-v3-script");
    let dir = write_plugin(
        &root,
        "script-bot",
        &json!({
            "id": "script-bot",
            "name": "脚本插件",
            "version": "1.0.0",
            "apiVersion": 3,
            "entry": "script",
        }),
    );

    let err = plugin_fs::read_manifest(&dir).expect_err("entry=script 必须拒载");
    println!("[script] read_manifest → Err({err})");

    assert!(err.contains("script"), "原因要指名 entry=script：{err}");
    assert!(
        err.contains("manifest"),
        "原因要说明当前宿主只执行 manifest：{err}"
    );

    let info = row(&root, "invalid:script-bot");
    println!(
        "[script] list → enabled={} error={:?}",
        info.enabled, info.error
    );
    assert!(!info.enabled);
    assert!(info.error.is_some());

    std::fs::remove_dir_all(&root).ok();
}

/// `PLUGIN_API_VERSION` 就是文档里写的那个 3；改了版本号必须同步改文档。
#[test]
fn plugin_api_version_is_three() {
    assert_eq!(
        PLUGIN_API_VERSION, 3,
        "docs/plugin-spec.md §10 的 1..=3 依赖这个值"
    );
}
