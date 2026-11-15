/* 体积统计的判据（从 `storage_usage.rs` 拆出：单文件 ≤300 行硬约束）。 */
use super::*;
use std::io::Write;

fn temp_dir(label: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!(
        "patina-storage-usage-{label}-{}",
        std::process::id()
    ));
    let _ = fs::remove_dir_all(&path);
    fs::create_dir_all(&path).unwrap();
    path
}

fn write_file(path: &Path, bytes: usize) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    let mut file = fs::File::create(path).unwrap();
    file.write_all(&vec![1; bytes]).unwrap();
}

fn storage_paths(data_root: PathBuf, webview_root: PathBuf) -> StoragePaths {
    StoragePaths {
        db_path: data_root.join(SQLITE_DB_FILE_NAME),
        backup_dir: data_root.join("backups"),
        remote_backup_temp_dir: data_root.join("remote-backup-temp"),
        data_root,
        webview_root,
        is_custom_data_root: true,
        is_custom_webview_root: true,
    }
}

#[test]
fn install_size_excludes_webview_cache_when_cache_root_is_install_dir() {
    let root = temp_dir("install-cache");
    let install_dir = root.join("Patina");
    let data_root = root.join("Data");
    let paths = storage_paths(data_root.clone(), install_dir.clone());

    write_file(&install_dir.join("Patina.exe"), 10);
    write_file(
        &install_dir
            .join(EBWEBVIEW_DIR_NAME)
            .join("Default")
            .join("Cache")
            .join("cached"),
        20,
    );
    write_file(&data_root.join(SQLITE_DB_FILE_NAME), 7);

    let snapshot = storage_size_snapshot(&install_dir, &paths, &data_root);
    let _ = fs::remove_dir_all(&root);

    assert_eq!(snapshot.install_dir_size_bytes, 10);
    assert_eq!(snapshot.data_size_bytes, 7);
}

#[test]
fn install_size_excludes_nested_custom_data_root() {
    let root = temp_dir("nested-data");
    let install_dir = root.join("Patina");
    let data_root = install_dir.join("Data");
    let webview_root = data_root.clone();
    let paths = storage_paths(data_root.clone(), webview_root.clone());

    write_file(&install_dir.join("Patina.exe"), 10);
    write_file(&data_root.join(SQLITE_DB_FILE_NAME), 7);
    write_file(&data_root.join("notes"), 5);
    write_file(&data_root.join("backups").join("backup.zip"), 9);
    write_file(&webview_root.join(EBWEBVIEW_DIR_NAME).join("cache"), 20);

    let snapshot = storage_size_snapshot(&install_dir, &paths, &data_root);
    let _ = fs::remove_dir_all(&root);

    assert_eq!(snapshot.install_dir_size_bytes, 10);
    assert_eq!(snapshot.data_size_bytes, 7);
    assert_eq!(snapshot.backup_dir_size_bytes, 9);
}

#[test]
fn data_size_counts_sqlite_family_files_only() {
    let root = temp_dir("sqlite-family");
    let install_dir = root.join("Patina");
    let data_root = install_dir.clone();
    let paths = storage_paths(data_root.clone(), data_root.clone());

    write_file(&install_dir.join("Patina.exe"), 10);
    write_file(&data_root.join(SQLITE_DB_FILE_NAME), 5);
    write_file(&data_root.join(format!("{SQLITE_DB_FILE_NAME}-wal")), 6);
    write_file(&data_root.join(format!("{SQLITE_DB_FILE_NAME}-shm")), 7);
    write_file(&data_root.join("remote-backup-temp").join("temp.zip"), 11);
    write_file(&data_root.join(EBWEBVIEW_DIR_NAME).join("cache"), 13);

    let snapshot = storage_size_snapshot(&install_dir, &paths, &data_root);
    let _ = fs::remove_dir_all(&root);

    assert_eq!(snapshot.install_dir_size_bytes, 10);
    assert_eq!(snapshot.data_size_bytes, 18);
}

/**
 * 设置页「数据目录」那一行的体积口径（[V0.13.x]）。
 *
 * 原本这一行读的是 `data_size_bytes`（活动库 sqlite 三个文件），于是「数据目录 12 MB」
 * 与用户在资源管理器里看到的几百 MB 对不上——计时库、Markdown、日志、插件全在
 * 同一个根下，却一分钱没算。所以钉住：数据根的读数必须是**递归**求和，
 * 且不能反过来把 `data_size_bytes` 也改成递归（那是「库文件多大」，另一件事）。
 */
#[test]
fn timing_data_size_counts_every_file_under_the_data_root() {
    let root = temp_dir("timing-root");
    let install_dir = root.join("Patina");
    let timing_root = root.join("com.timing.app");
    let data_root = timing_root.join("patina").join("data");
    let paths = storage_paths(
        data_root.clone(),
        timing_root.join("patina").join("webview"),
    );

    write_file(&timing_root.join("timing.db"), 11);
    write_file(&timing_root.join("md").join("note.md"), 13);
    write_file(&timing_root.join("logs").join("app.log"), 17);
    write_file(&data_root.join(SQLITE_DB_FILE_NAME), 19);

    let snapshot = storage_size_snapshot(&install_dir, &paths, &timing_root);
    let _ = fs::remove_dir_all(&root);

    assert_eq!(snapshot.data_size_bytes, 19);
    assert_eq!(snapshot.timing_data_size_bytes, 11 + 13 + 17 + 19);
}
