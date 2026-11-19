//! 搬迁清单第六项（`activity/data/activity.db`）的复制与核对。
//!
//! 与 `data_root_transfer_patina` 分成两个文件，是因为它们钉的是**两件事**：那边钉
//! 「活动数据到底有没有跟着搬」「搬完还会不会再导一次」，这边钉「搬过去的那份是不是
//! 一份**能用的**库」。合成一个文件就 308 行了（门禁 300），而且失败时该看哪一个也不清楚。
//!
//! 两条用例各自钉一条具体失效：
//! ① 按目录拷 → 主文件与 `-wal` 是两个时刻的拼接。搬迁是**运行时命令**，执行那一刻
//!    分析窗开着、活动库的池也开着、`-wal` 里还躺着没 checkpoint 的帧——所以这里故意
//!    让池保持打开，并先断言 `-wal` 非空（否则用例什么也证明不了）。
//! ② 副本坏了没人发现。`verify()` 比的是 `timing.db` 那五张表的行数，活动库不在其中；
//!    所以给副本补一次 `PRAGMA quick_check`，坏库必须当场报出来。
//!
//! 两种失效都必须靠**能只读打开 + 结构自检**才发现，所以夹具从
//! `data_root_transfer_patina` 借（同一套活动库造法，避免两份 DDL 各自漂移）。

use crate::infra::activity::storage_paths::{
    ACTIVITY_DATA_REL, LEGACY_ACTIVITY_DATA_REL, LEGACY_ACTIVITY_DB_FILE, SQLITE_DB_FILE_NAME,
};
use crate::infra::db;
use crate::services::data_root::transfer;
use crate::tests::data_root_transfer_patina::{
    inspect_activity, open_activity_db, write_activity_db,
};
use crate::tests::support;

/// ① 活库搬迁：`-wal` 里未合并的帧也必须在新根里，且副本是单文件、结构完好、源库不动。
#[tokio::test]
async fn live_activity_database_is_copied_as_one_consistent_snapshot() {
    let source = support::unique_dir("patina-live");
    let pool = db::init_pool(&source).await.expect("建业务库");
    let activity = source.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&activity).expect("建活动数据目录");
    /* 池**不关**：这就是「分析窗开着、活动库的池也开着」那一刻的真实状态。 */
    let live = open_activity_db(&activity.join(SQLITE_DB_FILE_NAME), 3, true).await;
    let wal = activity.join(format!("{SQLITE_DB_FILE_NAME}-wal"));
    assert!(
        std::fs::metadata(&wal).is_ok_and(|meta| meta.len() > 0),
        "前提：`-wal` 里必须有没 checkpoint 的帧，否则这条用例什么也证明不了"
    );

    let dest = support::unique_dir("patina-live-dest");
    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");
    transfer::verify(&pool, &dest).await.expect("核对应通过");

    let copied = dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    assert!(copied.is_file(), "活动库必须落在新根");
    let (rows, verdict) = inspect_activity(&copied).await;
    assert_eq!(
        rows, 3,
        "三行都得在：`-wal` 里那部分不能因为「只拷主文件」丢掉"
    );
    assert_eq!(verdict, "ok", "副本必须是 SQLite 自己认的结构完整库");
    let dest_activity = dest.join(ACTIVITY_DATA_REL);
    assert!(
        !dest_activity
            .join(format!("{SQLITE_DB_FILE_NAME}-wal"))
            .exists()
            && !dest_activity
                .join(format!("{SQLITE_DB_FILE_NAME}-shm"))
                .exists(),
        "VACUUM INTO 的产物是单文件：目标里不该有 -wal / -shm"
    );
    let source_rows: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&live)
        .await
        .expect("读源库");
    assert_eq!(source_rows, 3, "源库一行都不许少（搬迁只复制、不删除）");
    live.close().await;
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// ② 副本坏了要当场报：「搬过去一份打不开的库」不许当成功。
#[tokio::test]
async fn corrupted_activity_copy_fails_verification() {
    let source = support::unique_dir("patina-corrupt");
    let pool = db::init_pool(&source).await.expect("建业务库");
    let activity = source.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&activity).expect("建活动数据目录");
    write_activity_db(&activity.join(SQLITE_DB_FILE_NAME), 1).await;
    let dest = support::unique_dir("patina-corrupt-dest");
    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");

    std::fs::write(
        dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME),
        b"not a database",
    )
    .expect("弄坏副本");
    let err = transfer::verify(&pool, &dest)
        .await
        .expect_err("坏副本必须核对失败");
    assert!(
        err.message.contains("活动库副本"),
        "文案要点名是活动库：{}",
        err.message
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/* ───────────── M-16：Legacy 布局下「搬盘」不许静默漏掉活动历史 ─────────────

失效形态：T05 迁移失败会 fail-open 回旧布局（`patina/data`）。若六项清单把活动数据那一
项写成编译期常量 `activity/data`，`copy_all` 就去找一个不存在的目录 ⇒ 用户搬完盘、新根
里没有活动库、应用起来是空历史，**零报错**；确认对话框还会先说「活动数据：不存在」。
三个断言各钉一处：搬得过去 / 对话框报得对 / 新布局回归。 */

/// 造一个 **Legacy 布局**的根：只有 `<根>/patina/data/patina.db`。
async fn root_in_legacy_layout(
    tag: &str,
    rows: i64,
) -> (std::path::PathBuf, sqlx::SqlitePool, std::path::PathBuf) {
    let source = support::unique_dir(tag);
    let pool = db::init_pool(&source).await.expect("建业务库");
    let old_dir = source.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&old_dir).expect("建旧活动数据目录");
    let old_db = old_dir.join(LEGACY_ACTIVITY_DB_FILE);
    write_activity_db(&old_db, rows).await;
    (source, pool, old_db)
}

/// **M-16a**：Legacy 布局下 `copy_all` 必须把 `patina/data` 搬到 `activity/data`，
/// 且产物是 `activity.db`（新根永远是新布局）。
#[tokio::test]
async fn legacy_layout_activity_history_is_carried_into_the_new_layout() {
    let (source, pool, _old_db) = root_in_legacy_layout("legacy-carry", 2).await;
    let dest = support::unique_dir("legacy-carry-dest");

    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");

    let copied = dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    assert!(
        copied.is_file(),
        "Legacy 布局下活动历史必须被搬过去：否则用户搬盘后历史凭空消失且零报错"
    );
    let (rows, verdict) = inspect_activity(&copied).await;
    assert_eq!(rows, 2, "搬过去的是那份历史，不是空库");
    assert_eq!(verdict, "ok");
    let dest_activity = dest.join(ACTIVITY_DATA_REL);
    assert!(
        !dest_activity
            .join(format!("{SQLITE_DB_FILE_NAME}-wal"))
            .exists()
            && !dest_activity
                .join(format!("{SQLITE_DB_FILE_NAME}-shm"))
                .exists(),
        "VACUUM INTO 的产物是单文件"
    );
    assert!(
        source
            .join(LEGACY_ACTIVITY_DATA_REL)
            .join(LEGACY_ACTIVITY_DB_FILE)
            .is_file(),
        "旧库不删"
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}

/// **M-16b**：确认对话框看到的现状必须**包含**活动数据。
///
/// 只断 `has_bytes == true` 不够：一个只累加 `timing.db` 的实现也会让 `present` 为
/// true、`bytes` 非零，而对话框少报整整一份活动历史——「读数与实物不一致」那类静默 bug。
#[tokio::test]
async fn the_confirm_dialog_reports_the_activity_bytes_it_is_about_to_move() {
    let (source, pool, old_db) = root_in_legacy_layout("legacy-report", 2).await;
    /* `timing.db` 由 `init_pool` 建（体积不是常量），所以期望值现场量。 */
    let timing_len = std::fs::metadata(source.join("timing.db"))
        .expect("量 timing.db")
        .len();
    let activity_len = std::fs::metadata(&old_db).expect("量活动库").len();

    let entries = transfer::entries(&source);
    let activity = entries
        .iter()
        .find(|entry| entry.name == "activity")
        .expect("六项里必须有活动数据那一项");
    assert!(
        activity.present,
        "Legacy 布局下活动数据就在盘上，对话框不许报「不存在」"
    );
    assert_eq!(
        activity.bytes, activity_len,
        "活动数据那一项的体积必须是活动目录本身的体积"
    );
    assert_eq!(
        transfer::total_bytes(&source),
        timing_len + activity_len,
        "对话框报的总字节数必须包含活动数据：少报 18 MB 和「搬运失败」一样是坏事"
    );
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
}

/// **M-16c**：新布局下仍然正常（防止修 Legacy 时把常态弄坏）。
#[tokio::test]
async fn new_layout_keeps_working_after_the_runtime_derivation() {
    let source = support::unique_dir("new-layout");
    let pool = db::init_pool(&source).await.expect("建业务库");
    let new_dir = source.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&new_dir).expect("建活动数据目录");
    write_activity_db(&new_dir.join(SQLITE_DB_FILE_NAME), 4).await;
    let dest = support::unique_dir("new-layout-dest");

    transfer::copy_all(&pool, &source, &dest)
        .await
        .expect("复制应成功");

    let copied = dest.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    assert!(copied.is_file());
    assert_eq!(inspect_activity(&copied).await.0, 4);
    pool.close().await;
    std::fs::remove_dir_all(&source).ok();
    std::fs::remove_dir_all(&dest).ok();
}
