//! `activity_dir_migrate` 的判据（拆出本文件只为 300 行门禁）。
//!
//! 每条用例自己打包自己的输入（造真库、造伴生文件），**不复用**产品数据根：`prepare`
//! 对非产品根会跳过全局布局缓存的校验（见 `check_layout_cache`），所以这些用例不会
//! 把 `OnceLock` 污染成临时目录的结论。

use super::*;

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("activity-migrate-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// 造一份**真的能用**的库，里面有 `rows` 条记录。
fn make_db(path: &Path, rows: i64) {
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    tauri::async_runtime::block_on(async {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE sessions (id INTEGER PRIMARY KEY, app_name TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for index in 0..rows {
            sqlx::query("INSERT INTO sessions (app_name) VALUES (?)")
                .bind(format!("app{index}"))
                .execute(&pool)
                .await
                .unwrap();
        }
        pool.close().await;
    });
}

fn row_count(path: &Path) -> i64 {
    let path = path.to_path_buf();
    tauri::async_runtime::block_on(async move {
        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        rows
    })
}

fn journal_mode(path: &Path) -> String {
    let path = path.to_path_buf();
    tauri::async_runtime::block_on(async move {
        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let mode: String = sqlx::query_scalar("PRAGMA journal_mode")
            .fetch_one(&pool)
            .await
            .unwrap();
        pool.close().await;
        mode
    })
}

/// 造一个「旧布局」的数据根：真库 + 备份 + 诊断 + 导入标记。
fn legacy_root(tag: &str, rows: i64) -> PathBuf {
    let root = temp_root(tag);
    let old = root.join(LEGACY_ACTIVITY_DATA_REL);
    make_db(&old.join(LEGACY_ACTIVITY_DB_FILE), rows);
    std::fs::create_dir_all(old.join("backups")).unwrap();
    std::fs::write(old.join("backups").join("b.zip"), b"zip").unwrap();
    std::fs::create_dir_all(old.join("diagnostics")).unwrap();
    std::fs::write(old.join("diagnostics").join("d.jsonl"), b"{}\n").unwrap();
    std::fs::write(old.join(crate::app::legacy_import::IMPORT_MARKER), b"imported\n").unwrap();
    root
}

fn old_webview(root: &Path) -> PathBuf {
    root.join(activity_layout::activity_subdir_of(Layout::Old))
        .join(WEBVIEW_SUBDIR)
}

/// **M-1**：库走 `VACUUM INTO`（单文件、`journal_mode=delete`、无伴生文件），
/// `backups/` `diagnostics/` 导入标记**一起**过去（只搬库 = 备份面板变空），
/// 旧库**仍在且完好**（约束 4 / M-14）。
#[test]
fn the_data_step_copies_the_database_its_companions_and_keeps_the_old_one() {
    let root = legacy_root("data-basic", 3);

    let report = prepare(&root);
    assert_eq!(report.data, Step::Done);

    let new = root.join(ACTIVITY_DATA_REL);
    let new_db = new.join(SQLITE_DB_FILE_NAME);
    assert!(new_db.is_file());
    assert_eq!(row_count(&new_db), 3);
    assert_eq!(journal_mode(&new_db), "delete");
    for suffix in ["-wal", "-shm", "-journal"] {
        assert!(
            !new.join(format!("{SQLITE_DB_FILE_NAME}{suffix}")).exists(),
            "`VACUUM INTO` 的产物必须是单文件（{suffix} 不该存在）"
        );
    }
    assert!(new.join("backups").join("b.zip").is_file());
    assert!(new.join("diagnostics").join("d.jsonl").is_file());
    assert!(new
        .join(crate::app::legacy_import::IMPORT_MARKER)
        .is_file());

    /* M-14：新库在 ⇒ 旧库必须在（迁移模块没有删除旧路径的代码）。 */
    let old_db = root.join(LEGACY_ACTIVITY_DATA_REL).join(LEGACY_ACTIVITY_DB_FILE);
    assert!(old_db.is_file());
    assert_eq!(row_count(&old_db), 3);
}

/// **M-2**：跑第二趟什么都不做——`Nothing`，且新库 mtime 一个字节都不动。
#[test]
fn a_second_run_changes_nothing() {
    let root = legacy_root("idempotent", 2);
    assert_eq!(prepare(&root).data, Step::Done);

    let new_db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let before = std::fs::metadata(&new_db).unwrap().modified().unwrap();
    let second = prepare(&root);
    assert_eq!(second.data, Step::Nothing);
    assert_eq!(std::fs::metadata(&new_db).unwrap().modified().unwrap(), before);
}

/// **M-5**：源库读不出来 ⇒ 这趟失败、**不产出任何文件**、旧库原样保留 ⇒ 下次启动重试。
#[test]
fn a_broken_source_fails_without_writing_anything() {
    let root = temp_root("broken-source");
    let old = root.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&old).unwrap();
    std::fs::write(old.join(LEGACY_ACTIVITY_DB_FILE), b"not a database").unwrap();

    let report = prepare(&root);
    assert_eq!(report.data, Step::Failed);
    assert!(!root
        .join(ACTIVITY_DATA_REL)
        .join(SQLITE_DB_FILE_NAME)
        .exists());
    assert!(old.join(LEGACY_ACTIVITY_DB_FILE).is_file());
    /* 失败不落「已完成」标记：再跑一次还是 Failed（而不是 Nothing）。 */
    assert_eq!(prepare(&root).data, Step::Failed);
}

/// **M-6a**：上次进程死在「复制完、rename 未做」⇒ 下次启动补齐 profile，数据那半跳过。
#[test]
fn a_crash_between_the_two_steps_is_repaired_on_the_next_run() {
    let root = temp_root("crash-between");
    make_db(
        &root
            .join(LEGACY_ACTIVITY_DATA_REL)
            .join(LEGACY_ACTIVITY_DB_FILE),
        1,
    );
    /* 上一趟已经把库和伴生文件都复制完了（两步之间进程被杀），只剩 rename 没做。 */
    make_db(
        &root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME),
        1,
    );
    std::fs::create_dir_all(old_webview(&root)).unwrap();
    std::fs::write(old_webview(&root).join("Cookies"), b"cookie").unwrap();

    let report = prepare(&root);
    assert_eq!(report.data, Step::Nothing, "已经复制过的库不该再 VACUUM 一遍");
    assert_eq!(report.webview, Step::Done);
    assert!(root
        .join(ACTIVITY_SUBDIR)
        .join(WEBVIEW_SUBDIR)
        .join("Cookies")
        .is_file());
    assert!(!old_webview(&root).exists());
}

/// **M-6b**：上次进程死在 `VACUUM INTO` 中途 ⇒ 半截副本被丢弃、重做一遍拿到完整副本。
#[test]
fn a_half_written_copy_from_a_killed_run_is_discarded_and_retried() {
    let root = legacy_root("half-written", 4);
    let new_db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    std::fs::create_dir_all(new_db.parent().unwrap()).unwrap();
    std::fs::write(&new_db, b"half written by a killed VACUUM INTO").unwrap();

    let report = prepare(&root);
    assert_eq!(report.data, Step::Done);
    assert_eq!(row_count(&new_db), 4);
}

/// **M-13（四问）**：profile 搬不动（上一个进程还握着 profile 里的文件，WebView2 里最常见）
/// ⇒ ①正常返回不 panic ②`data` 那半照样切、`webview` 那半停在旧布局（两个开关不连坐）
/// ③旧 profile 原地不动、一个文件不少 ④下次启动仍重试（不是 `Nothing`）。
#[test]
fn a_blocked_profile_target_fails_open_per_switch() {
    let root = legacy_root("profile-blocked", 1);
    std::fs::create_dir_all(old_webview(&root)).unwrap();
    std::fs::write(old_webview(&root).join("Cookies"), b"cookie").unwrap();
    /* 目标位被一个**只读同名文件**占住：Windows 上 `MoveFileEx(REPLACE_EXISTING)` 撞到
    只读目标会直接 ACCESS_DENIED（不是「默默覆盖」）。这正是「`activity/webview` 位置上
    有个不是我们建的东西」的形状。 */
    let new_webview = root.join(ACTIVITY_SUBDIR).join(WEBVIEW_SUBDIR);
    std::fs::create_dir_all(new_webview.parent().unwrap()).unwrap();
    std::fs::write(&new_webview, b"occupied").unwrap();
    let mut perms = std::fs::metadata(&new_webview).unwrap().permissions();
    perms.set_readonly(true);
    std::fs::set_permissions(&new_webview, perms).unwrap();

    let report = prepare(&root);
    assert_eq!(report.data, Step::Done, "数据那半不该被 profile 拖累");
    assert_eq!(report.webview, Step::Failed);
    /* ②的两个开关并排断言：这是「profile 搬不动 ⇒ 数据也退回去」那个连坐的机械反例。 */
    assert_eq!(activity_layout::data_layout_checked_in(&root), Layout::New);
    assert_eq!(activity_layout::webview_layout_in(&root), Layout::Old);
    /* ③保留两份：旧 profile 原地不动，一个文件不少。 */
    assert!(old_webview(&root).join("Cookies").is_file());
    assert!(new_webview.is_file());

    let second = prepare(&root);
    assert_eq!(second.webview, Step::Failed, "下次启动仍要重试");
    assert_eq!(second.data, Step::Nothing);
}

/// **M-15（端到端）**：回滚窗口里旧库更新 ⇒ 判据停在旧布局，回滚期间写的记录仍然可见。
#[test]
fn the_rollback_window_leaves_the_decision_on_the_old_name() {
    let root = legacy_root("rollback", 2);
    assert_eq!(prepare(&root).data, Step::Done);
    let old_db = root.join(LEGACY_ACTIVITY_DATA_REL).join(LEGACY_ACTIVITY_DB_FILE);
    let new_db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    /* 回滚到旧版本写了一段时间：旧库 mtime 比副本新。 */
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(5);
    std::fs::File::options()
        .write(true)
        .open(&old_db)
        .unwrap()
        .set_modified(later)
        .unwrap();

    assert_eq!(activity_layout::data_layout_checked_in(&root), Layout::Old);
    assert_eq!(row_count(&old_db), 2, "回滚期间的历史不许被切走");
    assert_eq!(row_count(&new_db), 2);
}

/// 伴生文件与库本身**不许**走普通复制：`copy_missing` 必须跳过它们。
#[test]
fn the_plain_copier_never_touches_the_database_or_its_sidecars() {
    let from = temp_root("skip-from");
    let to = temp_root("skip-to");
    make_db(&from.join(LEGACY_ACTIVITY_DB_FILE), 1);
    for suffix in ["-wal", "-shm", "-journal"] {
        std::fs::write(from.join(format!("{LEGACY_ACTIVITY_DB_FILE}{suffix}")), b"x").unwrap();
    }
    std::fs::write(from.join("keep.txt"), b"keep").unwrap();

    copy_missing(&from, &to).unwrap();
    assert!(to.join("keep.txt").is_file());
    for name in [
        LEGACY_ACTIVITY_DB_FILE.to_string(),
        format!("{LEGACY_ACTIVITY_DB_FILE}-wal"),
        format!("{LEGACY_ACTIVITY_DB_FILE}-shm"),
        format!("{LEGACY_ACTIVITY_DB_FILE}-journal"),
    ] {
        assert!(!to.join(&name).exists(), "{name} 不该被普通复制带过去");
    }
}

/// 幂等的另一半：目标已存在的文件**不覆盖**（否则第二趟会把用户新写的备份用旧的盖掉）。
#[test]
fn copy_missing_never_overwrites_an_existing_target() {
    let from = temp_root("overwrite-from");
    let to = temp_root("overwrite-to");
    std::fs::create_dir_all(from.join("backups")).unwrap();
    std::fs::create_dir_all(to.join("backups")).unwrap();
    std::fs::write(from.join("backups").join("b.zip"), b"new").unwrap();
    std::fs::write(to.join("backups").join("b.zip"), b"old").unwrap();

    copy_missing(&from, &to).unwrap();
    assert_eq!(std::fs::read(to.join("backups").join("b.zip")).unwrap(), b"old");
}
