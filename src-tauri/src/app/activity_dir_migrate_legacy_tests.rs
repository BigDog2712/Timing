//! `activity_dir_migrate` 的第二组判据：**旧数据本身有没有被改写 / 被重新武装**。
//!
//! 与 `activity_dir_migrate_tests.rs` 分开只为 300 行门禁；那边钉的是「步骤怎么走」，
//! 这边钉的是「走完之后库里的东西一个字节都没变、首启导入没被重新武装」。

use super::*;

use crate::infra::activity::storage_paths::DATA_SUBDIR;
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use std::path::PathBuf;

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("activity-migrate2-{tag}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(&root).unwrap();
    root
}

/// 造一份带 `settings(key, value)` 的真库，`rows` 是两行**含旧路径的真实值**（M-11 的夹具本体）。
fn make_settings_db(path: &Path, rows: &[(&str, &str)]) {
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
        sqlx::query("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        for (key, value) in rows {
            sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?)")
                .bind(*key)
                .bind(*value)
                .execute(&pool)
                .await
                .unwrap();
        }
        pool.close().await;
    });
}

fn settings_rows(path: &Path) -> Vec<(String, String)> {
    let path = path.to_path_buf();
    tauri::async_runtime::block_on(async move {
        let options = SqliteConnectOptions::new().filename(&path).read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT key, value FROM settings ORDER BY key")
                .fetch_all(&pool)
                .await
                .unwrap();
        pool.close().await;
        rows
    })
}

/// **M-3**：「两个都在」的现场（降级后再升级）——`patina/data/patina.db` 与**空的**
/// `activity/` 同时存在 ⇒ 照样 `VACUUM INTO` 进已有目录，`patina/` 一字不动。
#[test]
fn an_empty_new_directory_does_not_stop_the_copy() {
    let root = temp_root("empty-new-dir");
    let old = root.join(LEGACY_ACTIVITY_DATA_REL);
    make_settings_db(&old.join(LEGACY_ACTIVITY_DB_FILE), &[("k", "v")]);
    std::fs::create_dir_all(root.join(ACTIVITY_SUBDIR)).unwrap();

    let report = prepare(&root);
    assert_eq!(report.data, Step::Done);
    assert_eq!(
        settings_rows(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME)),
        vec![("k".to_string(), "v".to_string())]
    );
    assert!(old.join(LEGACY_ACTIVITY_DB_FILE).is_file());
}

/// **M-11（硬要求）**：库里存着**旧路径**的两行配置（`…\Roaming\Patina\backups` /
/// `…\Roaming\Patina\exports`）⇒ 迁移之后**逐字节不变**。
///
/// 这条比判据 5（禁 `REPLACE(`）更硬：即使将来绕过判据改了实现，这条也会红。库是经
/// `VACUUM INTO` 过去的，所以真正被保护的是「没有任何代码去 UPDATE 这两行」。
#[test]
fn paths_stored_inside_the_database_are_never_rewritten() {
    let root = temp_root("inside-db-paths");
    let backup = r"\\?\C:\Users\someone\AppData\Roaming\Patina\backups";
    let export = r"\\?\C:\Users\someone\AppData\Roaming\Patina\exports";
    /* 第三种拼法是**小写**的：真机上两种写法并存（大写来自 `PRODUCT_FOLDER`，小写来自
    我们自己的旧目录名）。只钉大写的夹具挡不住 `REPLACE(value,'patina','activity')`——
    大小写敏感替换碰不到大写那份，用例会绿着放过它（V-8 第一次实测就是这样）。 */
    let remote = "/patina/backups";
    make_settings_db(
        &root
            .join(LEGACY_ACTIVITY_DATA_REL)
            .join(LEGACY_ACTIVITY_DB_FILE),
        &[
            ("scheduled_backup_config.target_dir", backup),
            ("scheduled_export_config.target_dir", export),
            ("remote_backup.remote_dir", remote),
        ],
    );

    assert_eq!(prepare(&root).data, Step::Done);
    let rows = settings_rows(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME));
    assert_eq!(rows.len(), 3);
    assert_eq!(rows[0].1, remote, "库里的旧路径不许被改写（小写形态）");
    assert_eq!(rows[1].1, backup, "库里的旧路径不许被改写");
    assert_eq!(rows[2].1, export, "库里的旧路径不许被改写");
}

/// **M-8（行为级）**：迁移之后首启导入的闸② 仍然是「已处理」——否则搬完一次，下次启动
/// 会从上游再导一份历史，用户看到的活动历史突然变成另一份数据集且零报错。
#[test]
fn the_first_run_import_is_not_rearmed_by_the_migration() {
    let root = temp_root("not-rearmed");
    let old = root.join(LEGACY_ACTIVITY_DATA_REL);
    make_settings_db(&old.join(LEGACY_ACTIVITY_DB_FILE), &[("k", "v")]);
    std::fs::write(
        old.join(crate::app::legacy_import::IMPORT_MARKER),
        b"imported\n",
    )
    .unwrap();
    /* 上游那份「别人装的 Patina」的库：闸①②③ 都不该让它进来。 */
    let upstream = root.join("upstream").join("patina.db");
    make_settings_db(&upstream, &[("k", "upstream")]);

    assert_eq!(prepare(&root).data, Step::Done);
    let data_dir = root.join(ACTIVITY_DATA_REL);
    let seeded = crate::app::legacy_import::seed_from(&data_dir, None, Some(&upstream));
    assert_eq!(seeded, Ok(None), "标记跟着数据一起过去了，闸② 必须仍然关着");
    assert_eq!(
        settings_rows(&data_dir.join(SQLITE_DB_FILE_NAME)),
        vec![("k".to_string(), "v".to_string())]
    );
}

/// **M-14**：四种结局下「新库在 ⇒ 旧库必须在」都成立。
///
/// `Failed` 那一档尤其要紧：「顺手删了旧库」在功能测试里完全看不见，只有这条看得见。
#[test]
fn the_old_database_survives_every_outcome() {
    /* ① Done（这趟搬了） */
    let root = temp_root("survive-done");
    let old = root.join(LEGACY_ACTIVITY_DATA_REL);
    make_settings_db(&old.join(LEGACY_ACTIVITY_DB_FILE), &[("k", "v")]);
    assert_eq!(prepare(&root).data, Step::Done);
    assert!(old.join(LEGACY_ACTIVITY_DB_FILE).is_file());

    /* ② Nothing（第二趟；目标已齐全） */
    assert_eq!(prepare(&root).data, Step::Nothing);
    assert!(old.join(LEGACY_ACTIVITY_DB_FILE).is_file());

    /* ③ Failed（源库是坏的 ⇒ 不产出任何东西，旧库当然还在） */
    let broken = temp_root("survive-failed");
    let broken_old = broken.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&broken_old).unwrap();
    std::fs::write(broken_old.join(LEGACY_ACTIVITY_DB_FILE), b"not a database").unwrap();
    assert_eq!(prepare(&broken).data, Step::Failed);
    assert!(broken_old.join(LEGACY_ACTIVITY_DB_FILE).is_file());
    assert!(!broken
        .join(ACTIVITY_DATA_REL)
        .join(SQLITE_DB_FILE_NAME)
        .exists());
}

/// **M-10**：大小写。真机上旧目录是小写 `patina`，而 `PRODUCT_FOLDER` 是大写 `Patina`；
/// Windows 文件系统不区分大小写，所以「`Patina/data` 里有一份库」也必须被认出来——
/// 否则应用会去开一个空的 `activity/data`，而用户的历史就在旁边。
#[test]
#[cfg(windows)]
fn a_capitalised_legacy_directory_is_recognised_on_windows() {
    let root = temp_root("case-insensitive");
    let capitalised = root.join("Patina").join(DATA_SUBDIR);
    make_settings_db(&capitalised.join(LEGACY_ACTIVITY_DB_FILE), &[("k", "v")]);

    let found = activity_layout::activity_source_in(&root);
    assert!(found.is_some(), "大写 `Patina/` 也必须被认成旧布局");
    assert_eq!(found.unwrap().0, Layout::Old);
    assert_eq!(prepare(&root).data, Step::Done);
    assert_eq!(
        settings_rows(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME)),
        vec![("k".to_string(), "v".to_string())]
    );
}
