//! `activity_layout` 的判据（拆出本文件只为 300 行门禁，见那个模块里 `#[path]` 那行的说明）。
//!
//! 这一组钉的是「两种布局怎么决议」：大部分是**纯文件系统**判据（造几个空文件比 mtime），
//! 只有完整性闸那两条要真库——因为「坏文件必须被认出来」这件事本来就只能在真库上测。

use super::*;
use std::fs;
use std::time::Duration;

fn temp_root(tag: &str) -> PathBuf {
    let root = std::env::temp_dir().join(format!("activity-layout-{tag}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    root
}

fn touch(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, b"x").unwrap();
}

/// 造一份**真的能用**的库（`PRAGMA quick_check` 会返回 `ok`）。
///
/// 用 sqlx 建而不是手搓文件头：判据要的是「一个 sqlite 认为完好的库」，手写字节会把
/// 用例变成「我的假文件恰好骗过了 quick_check 吗」。
fn make_valid_db(path: &Path) {
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    tauri::async_runtime::block_on(async {
        let options = SqliteConnectOptions::new()
            .filename(path)
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE probe (x INTEGER)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    });
}

/// 把 mtime 往前推 `seconds` 秒（不做 sleep，测试要快）。
fn push_mtime_forward(path: &Path, seconds: u64) {
    let later = SystemTime::now() + Duration::from_secs(seconds);
    fs::File::options()
        .write(true)
        .open(path)
        .unwrap()
        .set_modified(later)
        .unwrap();
}

#[test]
fn nothing_on_disk_means_old_layout() {
    let root = temp_root("empty");
    assert_eq!(fs_only_layout_in(&root), Layout::Old);
    assert!(activity_source_in(&root).is_none());
}

#[test]
fn only_new_db_means_new_layout() {
    let root = temp_root("new-only");
    touch(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME));
    assert_eq!(fs_only_layout_in(&root), Layout::New);
}

#[test]
fn only_old_db_means_old_layout() {
    let root = temp_root("old-only");
    touch(&root
        .join(LEGACY_ACTIVITY_DATA_REL)
        .join(LEGACY_ACTIVITY_DB_FILE));
    assert_eq!(fs_only_layout_in(&root), Layout::Old);
}

/// 约束 8：回滚期间旧版本继续写旧库 ⇒ 旧库 mtime 更新 ⇒ 必须回到旧布局，
/// 否则「回滚期间写的历史」在这一刻被切走、静默消失。
#[test]
fn newer_old_db_wins_so_a_rollback_run_is_not_lost() {
    let root = temp_root("rollback");
    let new_db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let old_db = root
        .join(LEGACY_ACTIVITY_DATA_REL)
        .join(LEGACY_ACTIVITY_DB_FILE);
    touch(&new_db);
    touch(&old_db);
    push_mtime_forward(&old_db, 1);
    assert_eq!(fs_only_layout_in(&root), Layout::Old);
}

/// 平局取 New（与约束 8 的写法一致：`old > new` 才算旧，`==` 落到新）。
#[test]
fn tie_between_the_two_copies_resolves_to_new() {
    let root = temp_root("tie");
    let new_db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let old_db = root
        .join(LEGACY_ACTIVITY_DATA_REL)
        .join(LEGACY_ACTIVITY_DB_FILE);
    touch(&new_db);
    touch(&old_db);
    let same = SystemTime::now();
    for db in [&new_db, &old_db] {
        fs::File::options()
            .write(true)
            .open(db)
            .unwrap()
            .set_modified(same)
            .unwrap();
    }
    assert_eq!(fs_only_layout_in(&root), Layout::New);
}

/// 两个开关不许连坐：数据走 New、profile 走 Old 是**合法组合**（profile 被占住搬不动）。
///
/// 这是「不许合成一个 `ProductLayout`」的**机械证明**：只要这段代码里还有任何一处把两个
/// 布局绑在一起看，下面两行断言就不可能同时在同一次调用里成立。
#[test]
fn webview_layout_is_independent_of_the_data_layout() {
    let root = temp_root("webview");
    make_valid_db(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME));
    fs::create_dir_all(root.join(activity_subdir_of(Layout::Old)).join(WEBVIEW_SUBDIR)).unwrap();
    assert_eq!(fs_only_layout_in(&root), Layout::New);
    /* 带闸那一档也必须是 New：这份库是真的，不该因为完整性检测而退回旧布局。 */
    assert_eq!(data_layout_checked_in(&root), Layout::New);
    assert_eq!(webview_layout_in(&root), Layout::Old);

    fs::create_dir_all(root.join(activity_subdir_of(Layout::New)).join(WEBVIEW_SUBDIR)).unwrap();
    assert_eq!(webview_layout_in(&root), Layout::New);
}

#[test]
fn source_rel_follows_the_layout() {
    let root = temp_root("rel");
    assert_eq!(activity_source_rel_in(&root), LEGACY_ACTIVITY_DATA_REL);
    touch(&root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME));
    assert_eq!(activity_source_rel_in(&root), ACTIVITY_DATA_REL);
}

/// 约束 7 的那道完整性闸：`VACUUM INTO` 被 kill 留下的半截文件比旧库**新**，
/// 只看 mtime 会把它判成 New ⇒ 应用去开一个坏库。这里钉「坏文件 = 当作没有新库」。
///
/// ⚠️ 同一分支还会打一条 WARN（见 `data_layout_checked_in`），但仓里没有日志捕获设施
/// （`platform::log` 只有文件 sink + stderr 镜像），所以这条只钉返回值。
#[test]
fn a_corrupt_new_db_alone_fails_open_to_the_old_layout() {
    let root = temp_root("corrupt");
    let db = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    fs::create_dir_all(db.parent().unwrap()).unwrap();
    fs::write(&db, b"half written by a killed VACUUM INTO").unwrap();
    assert_eq!(fs_only_layout_in(&root), Layout::New);
    assert_eq!(data_layout_checked_in(&root), Layout::Old);
}

/// 约束 7 的正面用例：新库**损坏且比旧库新**、旧库完好 ⇒ 必须回旧布局。
///
/// 这一条同时证伪一个看起来理所当然的简化：「新文件存在就是 New」。这里新文件存在、
/// mtime 也更新，只有完整性闸能把新库拦下去——两次断言并排就是「闸到底在哪一层」的证明。
#[test]
fn a_corrupt_new_db_newer_than_a_healthy_old_one_still_fails_open_to_old() {
    let root = temp_root("corrupt-vs-healthy");
    let bad = root.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let good = root
        .join(LEGACY_ACTIVITY_DATA_REL)
        .join(LEGACY_ACTIVITY_DB_FILE);
    make_valid_db(&good);
    fs::create_dir_all(bad.parent().unwrap()).unwrap();
    fs::write(&bad, b"truncated").unwrap();
    push_mtime_forward(&bad, 5);
    /* 只看文件：新库存在且更新 ⇒ New（这就是不加闸时会发生的事）。 */
    assert_eq!(fs_only_layout_in(&root), Layout::New);
    /* 加闸：新库读不出来 ⇒ 等同于没有新库 ⇒ 回旧布局。 */
    assert_eq!(data_layout_checked_in(&root), Layout::Old);
}

/// 反向证明：磁盘上只有一份**真的**旧库、里面有一行记录 ⇒ 判据必须指到它，
/// 而且按判据算出的库路径**确实能读出那一行**。
///
/// 这一条走的是生产链上的两步：`data_layout_checked_in` → `db_file_of`。任何一处把库名
/// 接成新布局（`activity.db`），失败形态都是「读不到那一行」——正是用户那边的
/// 「升级后历史全空、应用一切正常」。断言写成读值而不是读名字，就是为了让这条判据
/// 在「编译过、测试绿、历史全空」那个状态下也会红。
#[test]
fn a_real_legacy_database_is_the_one_the_layout_points_at() {
    let root = temp_root("legacy-real");
    let old_db = root
        .join(LEGACY_ACTIVITY_DATA_REL)
        .join(LEGACY_ACTIVITY_DB_FILE);
    make_valid_db(&old_db);
    tauri::async_runtime::block_on(async {
        let options = SqliteConnectOptions::new().filename(&old_db);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::query("INSERT INTO probe (x) VALUES (42)")
            .execute(&pool)
            .await
            .unwrap();
        pool.close().await;
    });

    let layout = data_layout_checked_in(&root);
    assert_eq!(layout, Layout::Old, "磁盘上只有旧库时必须回旧布局");
    let db = db_path_in(&root, layout);
    assert_eq!(db, old_db, "库名必须跟着布局走（Old ⇒ 旧库名）");

    let value = tauri::async_runtime::block_on(async {
        let options = SqliteConnectOptions::new().filename(&db).read_only(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        let value: Option<i64> = sqlx::query_scalar("SELECT x FROM probe")
            .fetch_optional(&pool)
            .await
            .unwrap();
        pool.close().await;
        value
    });
    assert_eq!(value, Some(42), "按判据算出的库必须能读出历史那一行");
}
