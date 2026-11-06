//! `infra::plugin_fs` 的单元测试（拆出以守住单文件 ≤300 行）。

use super::*;
use crate::models::plugin::{default_object, EntryKind, PluginContributes, QuickTimer};

fn sample() -> PluginManifest {
    PluginManifest {
        id: "moyu-kit".into(),
        name: "摸鱼套装".into(),
        version: "1.0.0".into(),
        api_version: 1,
        description: String::new(),
        entry: EntryKind::Manifest,
        enabled: true,
        contributes: PluginContributes::default(),
        permissions: Vec::new(),
        engines: default_object(),
        author: String::new(),
        homepage: String::new(),
        dependencies: default_object(),
    }
}

#[test]
fn accepts_minimal_manifest() {
    assert!(validate(&sample()).is_ok());
}

/* 启动头字段名（camelCase）与 `PluginManifest` 的映射是插件作者唯一能踩的坑，
所以用一段**内联 JSON** 钉住它：不依赖仓库里任何文件，也不需要把磁盘上的
某个包编进二进制。 */
#[test]
fn parses_inline_manifest_json() {
    let raw = r#"{
        "id": "moyu-kit",
        "name": "摸鱼套装",
        "version": "1.0.0",
        "apiVersion": 1,
        "description": "三条短时倒计时",
        "entry": "manifest",
        "enabled": false,
        "contributes": { "quickTimers": [ { "item": "摸鱼", "minutes": 25 } ] }
    }"#;
    let manifest: PluginManifest = serde_json::from_str(raw).expect("内联启动头应能解析");
    assert_eq!(manifest.id, "moyu-kit");
    assert_eq!(manifest.api_version, 1);
    assert!(!manifest.enabled);
    /* [v3] 缺省必须是 `{}` 而不是 `null`（docs/plugin-spec.md §10.2）：
    写成裸 `#[serde(default)]` 会得到 `Value::Null`，与规格差一个值，
    v0.11.6 做硬校验时就得多写一个 `is_null()` 分支。 */
    assert_eq!(manifest.engines, serde_json::json!({}));
    assert_eq!(manifest.dependencies, serde_json::json!({}));
    assert!(manifest.permissions.is_empty());
    assert_eq!(manifest.contributes.quick_timers.len(), 1);
    assert_eq!(manifest.contributes.quick_timers[0].minutes, 25);
    assert!(validate(&manifest).is_ok());
}

#[test]
fn rejects_uppercase_id() {
    let mut manifest = sample();
    manifest.id = "Moyu".into();
    assert!(validate(&manifest).is_err());
}

#[test]
fn rejects_future_api_version() {
    let mut manifest = sample();
    manifest.api_version = 9;
    assert!(validate(&manifest).is_err());
}

#[test]
fn rejects_script_entry() {
    let mut manifest = sample();
    manifest.entry = EntryKind::Script;
    let err = validate(&manifest).unwrap_err();
    assert!(err.contains("script"));
}

/* [v3] `contributes.mdSync` 已随内核化下架：写了它**不再拒载**，但必须给一条黄字警告，
否则作者会以为同步真的由这个插件在跑。 */
#[test]
fn v3_manifest_with_md_sync_is_accepted_with_a_warning() {
    let raw = r#"{
        "id": "old-md-sync",
        "name": "旧同步插件",
        "version": "2.0.0",
        "apiVersion": 3,
        "contributes": { "mdSync": { "bindings": [] } }
    }"#;
    let manifest: PluginManifest = serde_json::from_str(raw).expect("v3 清单应能解析");

    assert!(
        validate(&manifest).is_ok(),
        "mdSync 已下架：不校验、也不拒载"
    );
    let notes = warnings(&manifest);
    assert_eq!(notes.len(), 1, "{notes:?}");
    assert!(notes[0].contains("mdSync"), "{notes:?}");
}

/* 走一遍真实读盘：`read_manifest` 返回的是 `(清单, 警告)`，插件照常载入。 */
#[test]
fn read_manifest_returns_the_md_sync_warning() {
    let dir = std::env::temp_dir().join(format!("timing-plugin-v3-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join(MANIFEST_FILE),
        r#"{"id":"old-md-sync","name":"旧同步插件","version":"2.0.0","apiVersion":3,
            "contributes":{"mdSync":{"bindings":[]}}}"#,
    )
    .unwrap();

    let (manifest, notes) = read_manifest(&dir).expect("v3 清单应能载入");
    assert_eq!(manifest.api_version, 3);
    assert_eq!(notes.len(), 1, "{notes:?}");

    std::fs::remove_dir_all(&dir).ok();
}

#[test]
fn rejects_out_of_range_minutes() {
    let mut manifest = sample();
    manifest.contributes.quick_timers = vec![QuickTimer {
        item: "摸鱼".into(),
        minutes: 0,
    }];
    assert!(validate(&manifest).is_err());

    manifest.contributes.quick_timers[0].minutes = MAX_QUICK_TIMER_MINUTES + 1;
    assert!(validate(&manifest).is_err());

    manifest.contributes.quick_timers[0].minutes = 25;
    assert!(validate(&manifest).is_ok());
}
