//! `infra::legacy` 的单元测试（拆出以守住单文件 ≤300 行）。
//!
//! 这些用例都在临时目录里造「旧产品名的数据目录」，不碰真实的 `%APPDATA%`。

use super::*;
use std::fs;

/// 造一个「应用数据根」，返回 (根, 新数据目录, 旧数据目录)。
fn sandbox(tag: &str) -> (PathBuf, PathBuf, PathBuf) {
    let root = std::env::temp_dir().join(format!("timing-legacy-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let data = root.join("com.timing.app");
    let legacy = root.join(LEGACY_DIR);
    (root, data, legacy)
}

#[test]
fn migrates_db_and_wal_side_files() {
    let (root, data, legacy) = sandbox("wal");
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join(LEGACY_DB), b"main").unwrap();
    fs::write(legacy.join(format!("{LEGACY_DB}-wal")), b"wal").unwrap();

    assert!(adopt(&data).unwrap(), "应当报告已迁移");

    assert_eq!(fs::read(data.join(DB)).unwrap(), b"main");
    assert_eq!(fs::read(data.join(format!("{DB}-wal"))).unwrap(), b"wal");
    assert!(!data.join(LEGACY_DB).exists(), "旧名不该留在新目录里");
    assert!(legacy.join(LEGACY_DB).exists(), "旧目录要保留，不做删除");
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn keeps_existing_new_db_untouched() {
    let (root, data, legacy) = sandbox("keep");
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join(DB), b"new").unwrap();
    fs::create_dir_all(&legacy).unwrap();
    fs::write(legacy.join(LEGACY_DB), b"old").unwrap();

    assert!(!adopt(&data).unwrap(), "已有新库时不该迁移");
    assert_eq!(
        fs::read(data.join(DB)).unwrap(),
        b"new",
        "新数据不能被旧数据盖掉"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn copies_subdirectories_without_overwriting() {
    let (root, data, legacy) = sandbox("tree");
    fs::create_dir_all(legacy.join("plugins/demo")).unwrap();
    fs::write(legacy.join("plugins/demo/plugin.json"), b"{}").unwrap();
    fs::write(legacy.join("settings.json"), b"old").unwrap();
    fs::create_dir_all(&data).unwrap();
    fs::write(data.join("settings.json"), b"new").unwrap();

    assert!(adopt(&data).unwrap());

    assert!(
        data.join("plugins/demo/plugin.json").exists(),
        "子目录要带过来"
    );
    assert_eq!(
        fs::read(data.join("settings.json")).unwrap(),
        b"new",
        "同名文件保留新目录里的那份"
    );
    let _ = fs::remove_dir_all(&root);
}

#[test]
fn reports_nothing_when_legacy_dir_absent() {
    let (root, data, _legacy) = sandbox("none");
    fs::create_dir_all(&root).unwrap();

    assert!(!adopt(&data).unwrap(), "没有旧目录时不该报迁移");
    assert!(!data.exists(), "也不该凭空建出新目录");
    let _ = fs::remove_dir_all(&root);
}
