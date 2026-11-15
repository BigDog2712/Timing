//! `storage_paths` 的判据（拆出本文件只为 300 行门禁，见那个模块里 `#[path]` 那行的说明）。
//!
//! 钉三件事：库名只有一个真源、产品目录名的派生后果、两个子目录常量之间的算术关系。

use super::*;

use crate::infra::activity::activity_layout::{activity_subdir_of, db_file_in, db_file_of, Layout};

#[test]
fn missing_custom_database_never_uses_existing_default_database() {
    let root = std::env::temp_dir().join(format!("patina-path-resolution-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(SQLITE_DB_FILE_NAME), b"different database").unwrap();
    let defaults = StoragePaths::from_roots(
        root.clone(),
        root.clone(),
        false,
        false,
        SQLITE_DB_FILE_NAME,
    );
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

/// 备份目录与远端临时目录都挂在 `data_root` 下（`db_path` 不在这里断——那一条按布局
/// 钉在 `db_path_follows_the_layout_file_name_it_is_given` 里，见下面那段注释）。
#[test]
fn storage_paths_keep_remote_temp_under_data_root() {
    let paths = StoragePaths::from_roots(
        PathBuf::from("D:\\Patina Data"),
        PathBuf::from("D:\\Patina Data\\webview"),
        true,
        true,
        db_file_of(Layout::New),
    );

    /* 曾经这里有一条 `assert_eq!(paths.db_path, root.join(SQLITE_DB_FILE_NAME))`：
    左边是 `from_roots` 里的 `data_root.join(库名)`、右边同样是 `join(同一个常量)`，
    于是它**对任何常量取值都恒真**——库名接错时它照样绿。现在库名是入参了，等价断言
    只能是「两个不同的入参给出两个不同的结果」，那正是下面那条用例干的事。 */
    assert_eq!(paths.backup_dir, PathBuf::from("D:\\Patina Data\\backups"));
    assert_eq!(
        paths.remote_backup_temp_dir,
        PathBuf::from("D:\\Patina Data\\remote-backup-temp")
    );
}

/// 库与伴生文件的识别：这一组的反例（`backups/` `diagnostics/` 标记文件）才是重点——
/// 判定偏宽会把用户的备份当库跳过，偏窄会把 `-wal` 当普通文件直拷。
#[test]
fn only_the_database_and_its_sidecars_are_recognised() {
    assert!(is_database_file_name(SQLITE_DB_FILE_NAME));
    assert!(is_database_file_name(LEGACY_ACTIVITY_DB_FILE));
    for db in [SQLITE_DB_FILE_NAME, LEGACY_ACTIVITY_DB_FILE] {
        for sidecar in sqlite_sidecar_names_of(db) {
            assert!(is_database_file_name(&sidecar), "{sidecar} 必须被认出来");
        }
    }
    for other in ["backups", "diagnostics", "data-anchor.json", "activity.db.bak"] {
        assert!(!is_database_file_name(other), "{other} 不是库文件");
    }
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

/// `db_path` 的文件名必须是**调用方给的那个**，`from_roots` 不许自己去猜。
///
/// 两套布局各断一次，理由：只断一套时，把库名写死成**另一套**的那个值仍然绿——而
/// 「写死 `activity.db`」正是 fail-open 到 Old 之后的实际坏法：`data_root` 是
/// `<数据根>/patina/data`，应用会去开一个**空的新库**，用户历史留在同目录的 `patina.db`
/// 里没人读。界面正常、日志干净，只有历史全空。
///
/// 传给它的值就是生产侧 `default_storage_paths` 传的同一个来源（`db_file_of(<数据布局>)`）。
#[test]
fn db_path_follows_the_layout_file_name_it_is_given() {
    let root = std::env::temp_dir().join(format!("layout-db-name-{}", std::process::id()));
    let new_data_root = root.join(ACTIVITY_DATA_REL);
    let old_data_root = root.join(LEGACY_ACTIVITY_DATA_REL);

    let new_paths = StoragePaths::from_roots(
        new_data_root.clone(),
        root.join(activity_subdir_of(Layout::New)).join(WEBVIEW_SUBDIR),
        false,
        false,
        db_file_of(Layout::New),
    );
    assert_eq!(
        new_paths.db_path,
        new_data_root.join(SQLITE_DB_FILE_NAME),
        "New 布局下 db_path 必须是 activity/data/activity.db，实际是 {:?}",
        new_paths.db_path
    );

    let old_paths = StoragePaths::from_roots(
        old_data_root.clone(),
        root.join(activity_subdir_of(Layout::Old)).join(WEBVIEW_SUBDIR),
        false,
        false,
        db_file_of(Layout::Old),
    );
    assert_eq!(
        old_paths.db_path,
        old_data_root.join(LEGACY_ACTIVITY_DB_FILE),
        "Old 布局下 db_path 必须是 patina/data/patina.db，实际是 {:?}",
        old_paths.db_path
    );
    /* 两次调用的唯一差别是入参，所以这两条断言一起证明「库名是透传的，不是猜的」。 */
    assert_ne!(new_paths.db_path, old_paths.db_path);
}

/// 自定义数据根的库名只能看**磁盘事实**（`db_file_in`），不能借用产品根的 `data_layout()`。
///
/// 迁移例程只跑产品数据根，用户自己挑的那个目录里可能还躺着 T05 之前的 `patina.db`。
/// 按进程级布局取名 ⇒ 应用在自己的自定义根里开一个空的新库 ⇒「换了目录之后历史全空了」。
#[test]
fn a_custom_data_root_from_before_t05_keeps_reading_patina_db() {
    let root = std::env::temp_dir().join(format!("custom-legacy-root-{}", std::process::id()));
    std::fs::create_dir_all(&root).unwrap();
    std::fs::write(root.join(LEGACY_ACTIVITY_DB_FILE), b"legacy database").unwrap();

    assert_eq!(db_file_in(&root), LEGACY_ACTIVITY_DB_FILE);
    assert_eq!(
        StoragePaths::from_roots(
            root.clone(),
            root.join(WEBVIEW_SUBDIR),
            true,
            false,
            db_file_in(&root),
        )
        .db_path,
        root.join(LEGACY_ACTIVITY_DB_FILE)
    );

    /* 两份都在时取新库名：T05 之后的写入只会落在 `activity.db` 上，`patina.db` 那份是
    只读快照。这一句同时证明 `db_file_in` 不会因为旧文件残留而退回去。 */
    std::fs::write(root.join(SQLITE_DB_FILE_NAME), b"new database").unwrap();
    assert_eq!(db_file_in(&root), SQLITE_DB_FILE_NAME);

    std::fs::remove_dir_all(&root).unwrap();
}
