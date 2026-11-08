//! `models::md_sync` 的单元测试（拆出以守住单文件 ≤300 行）。

use super::*;

fn binding(kind: MdSyncKind, file: &str, heading: &str) -> MdSyncBinding {
    MdSyncBinding {
        kind,
        enabled: true,
        root: "C:\\vault".into(),
        file: file.into(),
        heading: heading.into(),
    }
}

#[test]
fn accepts_normal_binding() {
    let config = MdSyncConfig {
        cloud: None,
        poll_secs: 900,
        enabled: true,
        bindings: vec![binding(MdSyncKind::Timers, "{date}.md", "#### 事项计时")],
        ..MdSyncConfig::default()
    };
    assert!(config.validate().is_ok());
}

#[test]
fn rejects_absolute_or_escaping_file() {
    for file in ["C:\\x.md", "a/../../x.md", "/tmp/x.md"] {
        let config = MdSyncConfig {
            cloud: None,
            poll_secs: 900,
            enabled: true,
            bindings: vec![binding(MdSyncKind::Timers, file, "#### 事项计时")],
        ..MdSyncConfig::default()
    };
        assert!(config.validate().is_err(), "{file} 应被拒绝");
    }
}

#[test]
fn rejects_heading_without_text() {
    for heading in ["事项计时", "####", "####### 太深"] {
        let config = MdSyncConfig {
            cloud: None,
            poll_secs: 900,
            enabled: true,
            bindings: vec![binding(MdSyncKind::Timers, "{date}.md", heading)],
        ..MdSyncConfig::default()
    };
        assert!(config.validate().is_err(), "{heading} 应被拒绝");
    }
}

#[test]
fn rejects_duplicate_bindings() {
    let item = binding(MdSyncKind::Timers, "{date}.md", "#### 事项计时");
    let config = MdSyncConfig {
        cloud: None,
        poll_secs: 900,
        enabled: true,
        bindings: vec![item.clone(), item],
        ..MdSyncConfig::default()
    };
    assert!(config.validate().is_err());
}

#[test]
fn rejects_two_landings_for_one_kind() {
    let config = MdSyncConfig {
        cloud: None,
        poll_secs: 900,
        enabled: true,
        bindings: vec![
            binding(MdSyncKind::Notes, "a.md", "#### 便利贴"),
            binding(MdSyncKind::Notes, "b.md", "#### 便利贴"),
        ],
        ..MdSyncConfig::default()
    };
    assert!(config.validate().is_err());
}

#[test]
fn report_collects_kinds_once() {
    let mut report = MdSyncReport::new(1);
    report.note_imported(MdSyncKind::Timers, 2);
    report.note_imported(MdSyncKind::Timers, 1);
    report.note_imported(MdSyncKind::Notes, 0);
    assert_eq!(report.imported, 3);
    assert_eq!(report.kinds, vec![MdSyncKind::Timers]);
}
