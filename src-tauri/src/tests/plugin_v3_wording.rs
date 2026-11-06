//! 插件 v3 的**文案一致性**：代码里那句中文是否与 `docs/plugin-spec.md` 逐字相同。
//!
//! `docs/plugin-spec.md` §7 表格最后一行与 §10.8「设置页文案」都写了「两处逐字一致」。
//! 这条声明需要一个机械检查点，否则它只是一句愿望：改文案的人只看到文档或只看到代码，
//! 两边就会各自漂移。`MD_SYNC_WARNING` 是那段文档的**照抄**，断言 `plugin_fs::warnings()`
//! 的输出与之 `==`。
//!
//! 这里用**内联清单**（`serde_json::from_str::<PluginManifest>`）而不是临时目录：
//! 被测对象是 `warnings()` 这个纯函数，读盘那一段在 `plugin_v3_matrix.rs` 里已经覆盖，
//! 重复一遍只会让这条用例慢、且在下一次改目录约定时一起红。

use serde_json::json;

use crate::infra::plugin_fs;
use crate::models::plugin::PluginManifest;

/// 与 `docs/plugin-spec.md` 两处**逐字**相同的文案（§7「出错时你会看到什么」表格最后一行、
/// §10.8「设置页文案（与 §7 表格同一句，两处逐字一致）」）。
const MD_SYNC_WARNING: &str = "contributes.mdSync 已在 apiVersion 3 下架：Markdown 同步已归内核，本段被忽略；同步请在「设置 → 同步」里配置";

/// 声明了 `contributes.mdSync` → 恰好一条警告，且与文档逐字相同。
#[test]
fn the_md_sync_warning_matches_the_spec_verbatim() {
    let raw = json!({
        "id": "old-md-sync",
        "name": "旧同步插件",
        "version": "2.0.0",
        "apiVersion": 2,
        "contributes": { "mdSync": { "bindings": [] } },
    })
    .to_string();
    let manifest: PluginManifest = serde_json::from_str(&raw).expect("清单应能解析");

    let notes = plugin_fs::warnings(&manifest);

    println!(
        "[wording] 代码输出 = {}",
        notes.first().cloned().unwrap_or_default()
    );
    println!("[wording] 文档原文 = {MD_SYNC_WARNING}");
    println!(
        "[wording] 逐字一致 = {}",
        notes.first().map(String::as_str) == Some(MD_SYNC_WARNING)
    );

    assert_eq!(notes.len(), 1, "一条，不多不少：{notes:?}");
    assert_eq!(
        notes[0], MD_SYNC_WARNING,
        "代码文案与 docs/plugin-spec.md §7 / §10.8 不再逐字一致"
    );
}

/// 没有 `mdSync` 的清单不产生警告——`warnings` 不是「有贡献点就报一句」的噪音源。
#[test]
fn a_manifest_without_md_sync_produces_no_warning() {
    let raw = json!({
        "id": "plain-kit",
        "name": "普通插件",
        "version": "1.0.0",
        "apiVersion": 3,
        "contributes": { "quickTimers": [ { "item": "喝水", "minutes": 3 } ] },
    })
    .to_string();
    let manifest: PluginManifest = serde_json::from_str(&raw).expect("清单应能解析");

    assert_eq!(plugin_fs::warnings(&manifest), Vec::<String>::new());
}

/// 空的 `contributes` 仍合法（「只登记、不产生行为」的插件不该被拒载），也无警告。
#[test]
fn an_empty_contributes_block_is_legal_and_silent() {
    let raw = json!({
        "id": "empty-kit",
        "name": "空插件",
        "version": "1.0.0",
        "apiVersion": 3,
    })
    .to_string();
    let manifest: PluginManifest = serde_json::from_str(&raw).expect("空贡献的插件仍合法");

    assert_eq!(plugin_fs::warnings(&manifest), Vec::<String>::new());
    assert!(manifest.contributes.quick_timers.is_empty());
    assert!(manifest.contributes.md_sync.is_none());
}
