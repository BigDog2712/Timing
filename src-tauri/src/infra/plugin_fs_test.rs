//! `infra::plugin_fs` 的单元测试（拆出以守住单文件 ≤300 行）。

use super::*;
use crate::models::plugin::{EntryKind, PluginContributes, QuickTimer};

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
