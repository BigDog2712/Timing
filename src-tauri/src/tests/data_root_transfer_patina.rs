//! 数据根搬迁要带上 Patina 的活动数据，且**搬完之后不许再导一次**。
//!
//! 三条缺陷各自钉一处：
//! 1. 六项清单里没有 `patina` → 活动库留在旧根，新位置的 `patina.db` 不存在，
//!    启动期「首启导入」判定为「第一次用」，从独立安装那份拷一次 →
//!    用户看到的活动历史突然变成另一份数据集，全程零报错。
//! 2. 就算搬过去了，只要「目标不存在」还是唯一判据，同一件事就会在「用户从没在这个根里
//!    留下过活动库」时重演。所以有「已处理过」标记，且标记跟着 `patina/data` 一起搬。
//! 3. 用户手动删掉 `patina/data`（标记和库都在里面）→ 第 2 条那道闸也跟着没了。数据根
//!    是用户**显式选定**的时候（指针在），这就是「他想从零开始」，不该从上游灌一份回来。
//!
//! 所以这里四条用例：**两个库都在新根里、都能读、旧根不删** / **标记在就一个字节都不碰** /
//! **首启导入本身没被闸门弄坏**（闸门是叠加，不是替代） / **指针在时连标记都不写**。
//!
//! **不调** `app_dir::set()`（`OnceLock` 不可清除，会污染并行用例）：路径全由参数传进来。
//! 调 `seed_from` 的那几条**不能**待在 tokio 运行时里——它内部走
//! `tauri::async_runtime::block_on`，嵌套 `block_on` 会当场 panic，所以只有第一条
//! （要真的跑 `copy_all`）是 `#[tokio::test]`，另外几条用 `block_on` 单独跑建库那一段。

use std::path::Path;

use sqlx::sqlite::{SqliteConnectOptions, SqliteJournalMode, SqlitePoolOptions};
use sqlx::SqlitePool;

use crate::app::legacy_import;
use crate::infra::activity::app_paths::UPSTREAM_DB_FILE;
use crate::infra::activity::storage_paths::{
    ACTIVITY_DATA_REL, ACTIVITY_SUBDIR, SQLITE_DB_FILE_NAME,
};
use crate::infra::db;
use crate::infra::root_pointer;
use crate::services::data_root::transfer;
use crate::tests::support;

/// 同步跑一段异步设置（见文件头：`seed_from` 里已经有 `block_on` 了）。
fn block_on<T>(future: impl std::future::Future<Output = T>) -> T {
    tauri::async_runtime::block_on(future)
}

const CREATE_SESSIONS: &str = "CREATE TABLE IF NOT EXISTS sessions (\
    app_name TEXT NOT NULL, exe_name TEXT NOT NULL, \
    start_time INTEGER NOT NULL, end_time INTEGER NOT NULL)";

const INSERT_SESSION: &str =
    "INSERT INTO sessions (app_name, exe_name, start_time, end_time) VALUES (?, ?, ?, ?)";

/// 建一份「活动库」并塞 `rows` 条会话，**池留给调用方**。
///
/// `wal = true` 时切 WAL 且不 checkpoint：搬迁命令被点下去那一刻，分析窗与活动库的池正
/// 是这个状态，`-wal` 里躺着还没并进主文件的帧。
///
/// 表结构只留这几列：`activity_bridge::ACTIVITY_SQL` 用到的那几列才是这份数据被读的方式，
/// 这里是**搬迁**用例，不需要复刻上游全表。
pub(super) async fn open_activity_db(path: &Path, rows: i64, wal: bool) -> SqlitePool {
    let mut options = SqliteConnectOptions::new()
        .filename(path)
        .create_if_missing(true);
    if wal {
        options = options.journal_mode(SqliteJournalMode::Wal);
    }
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("建活动库");
    sqlx::query(CREATE_SESSIONS)
        .execute(&pool)
        .await
        .expect("建 sessions");
    for index in 0..rows {
        sqlx::query(INSERT_SESSION)
            .bind(format!("App{index}"))
            .bind(format!("app{index}.exe"))
            .bind(1_000_i64 + index)
            .bind(2_000_i64 + index)
            .execute(&pool)
            .await
            .expect("插会话");
    }
    pool
}

/// 建一份**关掉的**活动库（当「独立安装那一份」用）。
pub(super) async fn write_activity_db(path: &Path, rows: i64) {
    open_activity_db(path, rows, false).await.close().await;
}

/// 只读打开一份活动库：返回（会话行数, `PRAGMA quick_check` 的结论）。
/// 「能打开」与「真的是那份数据、结构没坏」是三件事，所以一起查。
pub(super) async fn inspect_activity(path: &Path) -> (i64, String) {
    let options = SqliteConnectOptions::new().filename(path).read_only(true);
    let pool: SqlitePool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("打开活动库");
    let rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&pool)
        .await
        .expect("数行");
    let verdict: String = sqlx::query_scalar("PRAGMA quick_check")
        .fetch_one(&pool)
        .await
        .expect("quick_check");
    pool.close().await;
    (rows, verdict)
}

async fn count_sessions(path: &Path) -> i64 {
    inspect_activity(path).await.0
}

/// 旧根：一个正常的数据根（`timing.db` + 活动库 + 运行中的 WebView2 缓存）。
///
/// 活动数据按**当前**布局搭（`activity/data/activity.db`）：这是 T05 之后的常态，
/// 「旧布局也能搬」由 `data_root_transfer_patina_legacy` 与 M-16 那组用例覆盖。
async fn root_with_activity(tag: &str) -> (std::path::PathBuf, SqlitePool) {
    let dir = support::unique_dir(tag);
    let pool = db::init_pool(&dir).await.expect("建库");
    let activity = dir.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&activity).expect("建 activity/data");
    write_activity_db(&activity.join(SQLITE_DB_FILE_NAME), 1).await;
    std::fs::write(activity.join(legacy_import::IMPORT_MARKER), b"imported\n").expect("写标记");
    /* WebView2 的用户数据目录：切换时正被窗口占着，搬它只会拿到一批被锁的文件。 */
    let cache = dir.join(ACTIVITY_SUBDIR).join("webview").join("Cache");
    std::fs::create_dir_all(&cache).expect("建缓存目录");
    std::fs::write(cache.join("blob"), b"cache").expect("写缓存");
    (dir, pool)
}

/// ① 搬迁把活动库带到新根：两个库都在、都能读、旧根不删、缓存不搬、标记跟着数据走。
#[tokio::test]
async fn moving_the_root_carries_the_activity_database() {
    let (source, pool) = root_with_activity("transfer-patina").await;
    let dest = support::unique_dir("transfer-patina-dest");

    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");

    let copied = dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    assert!(
        copied.is_file(),
        "活动库必须跟着数据根一起搬：新位置没有它 = 用户的活动历史没了"
    );
    assert!(dest.join("timing.db").is_file(), "两个库都要在新根里");
    assert_eq!(count_sessions(&copied).await, 1, "搬过去的是那份历史，不是空库");
    assert!(
        source.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME).is_file(),
        "旧目录不删（用户重启确认没问题之后自己删）"
    );
    assert!(
        dest.join(ACTIVITY_DATA_REL).join(legacy_import::IMPORT_MARKER).is_file(),
        "「已处理过」标记必须跟着活动数据一起走，否则新位置等于从没导入过"
    );
    assert!(
        !dest.join(ACTIVITY_SUBDIR).join("webview").exists(),
        "WebView2 缓存不搬：它正被运行中的窗口占用，新位置会自己重建"
    );

    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// ② 标记在 → 首启导入整个跳过，即使目标库不存在（这正是搬迁之后最容易踩的形态）。
///
/// 前提：源库是**真的能拷**的（先数一遍行数），否则「没复制」可能只是因为源不可用。
#[test]
fn marker_blocks_the_first_run_import_even_when_the_library_is_missing() {
    let root = support::unique_dir("patina-marker");
    let data_dir = root.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&data_dir).expect("建 data");
    std::fs::write(data_dir.join(legacy_import::IMPORT_MARKER), b"imported\n").expect("写标记");
    let upstream = root.join("upstream").join(UPSTREAM_DB_FILE);
    std::fs::create_dir_all(root.join("upstream")).expect("建 upstream 目录");
    block_on(write_activity_db(&upstream, 2));
    assert_eq!(
        block_on(count_sessions(&upstream)),
        2,
        "源库必须是一份真库：否则「没复制」证明不了是标记拦住的"
    );

    let outcome = legacy_import::seed_from(&data_dir, None, Some(&upstream)).expect("不该失败");

    assert!(outcome.is_none(), "标记在 = 已处理过，不许再导一次");
    assert!(
        !data_dir.join(SQLITE_DB_FILE_NAME).exists(),
        "标记在时一个字节都不该落盘"
    );
    std::fs::remove_dir_all(&root).ok();
}

/// ③ 首启导入本身没被标记弄坏：第一次真的导、导完写标记、第二次不覆盖已有历史、
/// 「没有源」也写标记（否则每次启动都白探一遍，用户后装 Patina 会突然被灌一份历史）。
#[test]
fn first_run_import_copies_the_upstream_database_and_writes_the_marker() {
    let root = support::unique_dir("patina-import");
    let data_dir = root.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&data_dir).expect("建 data");
    let upstream = root.join("upstream").join(UPSTREAM_DB_FILE);
    std::fs::create_dir_all(root.join("upstream")).expect("建 upstream 目录");
    block_on(write_activity_db(&upstream, 2));

    let target = legacy_import::seed_from(&data_dir, None, Some(&upstream))
        .expect("首启导入应成功")
        .expect("第一次必须要导");
    assert_eq!(target, data_dir.join(SQLITE_DB_FILE_NAME));
    assert_eq!(
        block_on(count_sessions(&target)),
        2,
        "导过来的是源库那份历史"
    );
    assert!(
        data_dir.join(legacy_import::IMPORT_MARKER).is_file(),
        "导完必须写标记"
    );
    assert!(upstream.is_file(), "源库只读，不许动它");

    /* 第二次：源里又多了几行，标记在 → 既不再导，也不许覆盖已经有的那份。 */
    block_on(write_activity_db(&upstream, 3));
    assert!(
        legacy_import::seed_from(&data_dir, None, Some(&upstream))
            .expect("第二次不该失败")
            .is_none(),
        "标记在时第二次必须是 None"
    );
    assert_eq!(
        block_on(count_sessions(&target)),
        2,
        "第二次不许把用户的历史换成源库那份"
    );

    /* 没有源 = 也是「处理过」：不写标记的话，用户后来装了独立 Patina，下次启动就会被灌一份。 */
    let fresh = root.join("patina2").join("data");
    std::fs::create_dir_all(&fresh).expect("建 data");
    assert!(
        legacy_import::seed_from(&fresh, None, None)
            .expect("没有源不该失败")
            .is_none()
    );
    assert!(
        fresh.join(legacy_import::IMPORT_MARKER).is_file(),
        "没有源也要写标记"
    );
    std::fs::remove_dir_all(&root).ok();
}

/// ④ 数据根存在指针 → 一律不导，连标记都不写。
///
/// 这是第 3 条缺陷的靶子：用户手动删掉 `patina/data`（标记和库都在里面），如果只看
/// 「标记不在 + 目标不在」，就会把独立安装那份历史灌回来——他要的是从零开始。
#[test]
fn pointer_present_blocks_the_first_run_import_without_writing_the_marker() {
    let root = support::unique_dir("patina-pointer");
    let data_dir = root.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&data_dir).expect("建 data");
    let upstream = root.join("upstream").join(UPSTREAM_DB_FILE);
    std::fs::create_dir_all(root.join("upstream")).expect("建 upstream 目录");
    block_on(write_activity_db(&upstream, 2));
    assert_eq!(
        block_on(count_sessions(&upstream)),
        2,
        "源库必须是真库：否则「没导」证明不了是指针拦住的"
    );
    /* 指针只由 `root_pointer` 写得出（`%APPDATA%\<identifier>\data-root.json`）。 */
    let appdata = root.join("appdata");
    std::fs::create_dir_all(&appdata).expect("建 appdata");
    root_pointer::write(&appdata, "/some/custom/root", None).expect("写指针");

    let outcome =
        legacy_import::seed_from(&data_dir, Some(&appdata), Some(&upstream)).expect("不该失败");

    assert!(
        outcome.is_none(),
        "指针在 = 数据根是用户显式选的，不许从上游灌一份"
    );
    assert!(
        !data_dir.join(SQLITE_DB_FILE_NAME).exists(),
        "指针在时一个字节都不该落盘"
    );
    assert!(
        !data_dir.join(legacy_import::IMPORT_MARKER).is_file(),
        "指针闸拉下时连标记都不写：用户把根挪回默认位置后，首启导入该还能正常工作"
    );
    std::fs::remove_dir_all(&root).ok();
}
