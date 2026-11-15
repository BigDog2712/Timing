use crate::models::insight::storage::StorageSizeSnapshot;
use crate::infra::insight::storage_paths::{StoragePaths, SQLITE_DB_FILE_NAME};
use std::fs;
use std::path::{Path, PathBuf};

const EBWEBVIEW_DIR_NAME: &str = "EBWebView";

pub fn storage_size_snapshot(
    install_dir: &Path,
    paths: &StoragePaths,
    timing_data_root: &Path,
) -> StorageSizeSnapshot {
    StorageSizeSnapshot {
        install_dir_size_bytes: install_dir_size(install_dir, paths),
        data_size_bytes: sqlite_data_size(&paths.data_root),
        timing_data_size_bytes: timing_data_size(timing_data_root),
        backup_dir_size_bytes: dir_size(&paths.backup_dir),
    }
}

/// 数据根的**递归**体积（计时库 + Markdown + 活动库 + 日志 + 插件 + 备份）。
///
/// 口径与设置页那一行一致：用户点开资源管理器看到多少，这里就报多少。
/// 递归本身跳过 reparse point / symlink（`dir_size_excluding`），否则一个指向
/// 整块盘的联接点就能让读数瞬间变成 1 TB。
fn timing_data_size(data_root: &Path) -> u64 {
    dir_size(data_root)
}

fn install_dir_size(install_dir: &Path, paths: &StoragePaths) -> u64 {
    let excluded = install_exclusions(install_dir, paths);
    dir_size_excluding(install_dir, &excluded)
}

fn install_exclusions(install_dir: &Path, paths: &StoragePaths) -> Vec<PathBuf> {
    let mut excluded = Vec::new();

    push_nested_exclusion(&mut excluded, install_dir, &paths.data_root);
    push_nested_exclusion(&mut excluded, install_dir, &paths.webview_root);
    push_nested_exclusion(
        &mut excluded,
        install_dir,
        &paths.webview_root.join(EBWEBVIEW_DIR_NAME),
    );
    push_nested_exclusion(&mut excluded, install_dir, &paths.backup_dir);
    push_nested_exclusion(&mut excluded, install_dir, &paths.remote_backup_temp_dir);

    for path in sqlite_data_paths(&paths.data_root) {
        push_nested_exclusion(&mut excluded, install_dir, &path);
    }

    excluded
}

fn push_nested_exclusion(excluded: &mut Vec<PathBuf>, root: &Path, path: &Path) {
    if path_is_nested_under(root, path) {
        excluded.push(path.to_path_buf());
    }
}

fn path_is_nested_under(root: &Path, path: &Path) -> bool {
    if same_path(root, path) {
        return false;
    }

    let root_key = path_key(root);
    let path_key = path_key(path);
    path_key.starts_with(&format!("{root_key}/"))
}

fn same_path(left: &Path, right: &Path) -> bool {
    path_key(left) == path_key(right)
}

fn path_key(path: &Path) -> String {
    let mut key = path.to_string_lossy().replace('\\', "/");
    while key.len() > 1 && key.ends_with('/') {
        key.pop();
    }

    #[cfg(windows)]
    {
        key.to_lowercase()
    }

    #[cfg(not(windows))]
    {
        key
    }
}

fn sqlite_data_size(data_root: &Path) -> u64 {
    sqlite_data_paths(data_root)
        .iter()
        .map(|path| file_size(path))
        .sum()
}

fn sqlite_data_paths(data_root: &Path) -> [PathBuf; 3] {
    [
        data_root.join(SQLITE_DB_FILE_NAME),
        data_root.join(format!("{SQLITE_DB_FILE_NAME}-wal")),
        data_root.join(format!("{SQLITE_DB_FILE_NAME}-shm")),
    ]
}

fn dir_size(path: &Path) -> u64 {
    dir_size_excluding(path, &[])
}

fn dir_size_excluding(path: &Path, excluded: &[PathBuf]) -> u64 {
    if !path.exists() || is_reparse_or_symlink(path) || is_excluded(path, excluded) {
        return 0;
    }
    let Ok(metadata) = fs::metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }

    let mut total = 0;
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if is_excluded(&path, excluded) || is_reparse_or_symlink(&path) {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            total += dir_size_excluding(&path, excluded);
        } else {
            total += metadata.len();
        }
    }
    total
}

fn is_excluded(path: &Path, excluded: &[PathBuf]) -> bool {
    excluded
        .iter()
        .any(|excluded_path| same_path(path, excluded_path))
}

fn file_size(path: &Path) -> u64 {
    if is_reparse_or_symlink(path) {
        return 0;
    }
    fs::metadata(path)
        .map(|metadata| metadata.len())
        .unwrap_or(0)
}

fn is_reparse_or_symlink(path: &Path) -> bool {
    let Ok(metadata) = fs::symlink_metadata(path) else {
        return false;
    };
    if metadata.file_type().is_symlink() {
        return true;
    }

    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0
    }

    #[cfg(not(windows))]
    {
        false
    }
}

#[cfg(test)]
#[path = "storage_usage_tests.rs"]
mod tests;
