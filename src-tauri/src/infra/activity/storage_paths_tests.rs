//! `storage_paths` 的判据（拆出本文件只为 300 行门禁，见那个模块里 `#[path]` 那行的说明）。
//!
//! 钉三件事：库名只有一个真源、产品目录名的派生后果、两个子目录常量之间的算术关系。

use super::*;

#[test]
fn missing_custom_database_never_uses_existing_default_database() {
    let root = std::env::temp_dir().join(format!("patina-path-resolution-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(SQLITE_DB_FILE_NAME), b"different database").unwrap();
    let defaults = StoragePaths::from_roots(root.clone(), root.clone(), false, false);
    let state = serde_json::from_value(serde_json::json!({
        "format":"patina.storage-control.v1", "profile":"dev", "dataRoot":root.join("missing"),
        "webviewRoot":null, "pending":null, "cleanupFiles":[],
        "maintenance":{"format":"patina.storage-maintenance-state.v1", "lastWebviewCacheTrimAtMs":null,"lastMaintenanceError":null}
    })).unwrap();
    assert!(resolve_roots(defaults, state)
        .unwrap_err()
        .contains("custom database"));
    assert_eq!(
        std::fs::read(root.join(SQLITE_DB_FILE_NAME)).unwrap(),
        b"different database"
    );
    std::fs::remove_file(root.join(SQLITE_DB_FILE_NAME)).unwrap();
    std::fs::remove_dir(root).unwrap();
}

#[test]
fn custom_webview_root_uses_product_root_as_webview_parent() {
    assert_eq!(
        derive_custom_webview_root(Path::new("D:\\Patina Data")),
        PathBuf::from("D:\\Patina Data")
    );
}

#[test]
fn custom_data_root_uses_product_folder_under_selected_root() {
    assert_eq!(
        derive_custom_data_root(Path::new("D:\\Storage"), "Patina"),
        PathBuf::from("D:\\Storage\\Patina")
    );
}

#[test]
fn custom_data_root_does_not_duplicate_product_folder() {
    assert_eq!(
        derive_custom_data_root(Path::new("D:\\Storage\\Patina"), "Patina"),
        PathBuf::from("D:\\Storage\\Patina")
    );
}

#[test]
fn custom_data_root_still_honours_the_shipped_product_folder_name() {
    /* 这条锁的是 `PRODUCT_FOLDER` 的**后果**，值锁在 `app_paths` 的
    `product_and_identifier_coordinates_are_frozen` 里。为什么两处都要：用户选根时
    选成 `D:\Patina`，`derive_custom_data_root` 必须认作「已经是产品目录」而不再拼一层。
    `PRODUCT_FOLDER` 一改名，同一句话就变成 `D:\Patina\NewName` —— 数据根静默搬家，
    用户在设置页看到的是「已切换」而历史全空。

    传真实常量而不是字面量：传字面量的话它只测到 `product_folder_name_eq` 的实现，
    `PRODUCT_FOLDER` 改了照样绿。 */
    assert_eq!(
        derive_custom_data_root(Path::new(r"D:\Patina"), app_paths::PRODUCT_FOLDER),
        PathBuf::from(r"D:\Patina")
    );
}

#[test]
fn storage_paths_keep_remote_temp_under_data_root() {
    let paths = StoragePaths::from_roots(
        PathBuf::from("D:\\Patina Data"),
        PathBuf::from("D:\\Patina Data\\webview"),
        true,
        true,
    );

    /* 用常量拼期望值而不是写字面量：这条测的是「库名只有一个真源」，写死**新库名**就只
    测到常量当天等于什么，改名时它照样绿。 */
    assert_eq!(
        paths.db_path,
        PathBuf::from("D:\\Patina Data").join(SQLITE_DB_FILE_NAME)
    );
    assert_eq!(paths.backup_dir, PathBuf::from("D:\\Patina Data\\backups"));
    assert_eq!(
        paths.remote_backup_temp_dir,
        PathBuf::from("D:\\Patina Data\\remote-backup-temp")
    );
}

/// 三个常量之间的**算术关系**：`ACTIVITY_DATA_REL` 必须恒等于
/// `ACTIVITY_SUBDIR + "/" + DATA_SUBDIR`。
///
/// 钉这条的理由：`ACTIVITY_DATA_REL` 是给路径拼接用的字面量，另外两个是给它做解释的。
/// 哪天有人只改其中一个（比如把子目录改成 `activity2`），布局决议与 `transfer` 的清单
/// 会各拿一半，症状是「搬完新根里没有活动库」——所以让它们在编译产物里也保持一致，
/// 比注释可靠。
#[test]
fn activity_data_rel_is_the_concatenation_of_its_two_parts() {
    assert_eq!(
        format!("{ACTIVITY_SUBDIR}/{DATA_SUBDIR}"),
        ACTIVITY_DATA_REL,
        "`ACTIVITY_DATA_REL` 与两个子目录名必须同源"
    );
    /* 旧名也得是同一个形状：它的父段就是 `activity_subdir_of(Old)` 的来源。 */
    assert_eq!(
        format!(
            "{}/{}",
            super::super::activity_layout::activity_subdir_of(
                super::super::activity_layout::Layout::Old
            ),
            DATA_SUBDIR
        ),
        LEGACY_ACTIVITY_DATA_REL,
        "旧布局的两个名字必须同源"
    );
}
