//! 旧版（五项清单）搬迁用户的**孤儿活动库**：`switch()` 要把它从旧根捞到新根。
//!
//! 失效形态：旧清单里没有 `patina` 这一项，那批用户搬迁时 `patina/data` 留在了旧根；新版
//! 清单只在**当前根**里找它 → 报「缺失跳过」，标记也不在当前根 → 当前根缺 `patina.db` 时
//! 启动期还会从上游重导一份。数据还在、看着像丢了、日志干净——与本轮第 6 条同一类失效。
//!
//! 判据来自指针的 `previous`（切换那一刻**正在生效**的根），而它必须在
//! `root_pointer::write` **之前**读：那次写会把 `previous` 换成新的 `current`，旧根就再也
//! 找不回来了。两条用例分别钉「补」与「不补」：
//! ① 当前根没有活动库 + 旧根有 → 捞回来；
//! ② 当前根已经有活动库 → 不插手（正常路径已经搬过，旧根那份可能更旧，覆盖就是倒退）。

use crate::infra::activity::storage_paths::{
    ACTIVITY_DATA_REL, LEGACY_ACTIVITY_DATA_REL, LEGACY_ACTIVITY_DB_FILE, SQLITE_DB_FILE_NAME,
};
use crate::infra::db;
use crate::infra::root_pointer;
use crate::services::data_root::switch;
use crate::tests::data_root_transfer_patina::{inspect_activity, write_activity_db};
use crate::tests::support;

/// 造一个「旧版搬过、`patina/data` 留在旧根」的现场：`appdata` 里的指针
/// `dataDir = current`、`previous = legacy`。
fn pointer_pointing_back(
    appdata: &std::path::Path,
    current: &std::path::Path,
    legacy: &std::path::Path,
) {
    std::fs::create_dir_all(appdata).expect("建 appdata");
    root_pointer::write(
        appdata,
        &current.display().to_string(),
        Some(&legacy.display().to_string()),
    )
    .expect("写指针");
}

/// ① 旧根有活动库、当前根没有 → 切换时补到新根：N 行都在、结构完好、旧根不删、其他项不补。
#[tokio::test]
async fn orphan_activity_database_in_the_previous_root_is_recovered() {
    let legacy = support::unique_dir("patina-legacy-old");
    /* 旧根是 **T05 之前的版本**写的 ⇒ 它里面就是 `patina/data/patina.db`。 */
    let legacy_activity = legacy.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&legacy_activity).expect("建旧根活动数据目录");
    write_activity_db(&legacy_activity.join(LEGACY_ACTIVITY_DB_FILE), 3).await;
    /* 旧根里再放一个**别的**项：捞回只补活动库，不许把它也带过来。 */
    std::fs::create_dir_all(legacy.join("logs")).expect("建旧根 logs");
    std::fs::write(legacy.join("logs").join("app.log"), b"old").expect("写旧日志");

    let current = support::unique_dir("patina-legacy-current");
    let pool = db::init_pool(&current).await.expect("建业务库");
    let appdata = support::unique_dir("patina-legacy-appdata");
    pointer_pointing_back(&appdata, &current, &legacy);

    let target = support::unique_dir("patina-legacy-new");
    switch(&pool, &appdata, &current, &target.display().to_string())
        .await
        .expect("切换应成功");

    let recovered = target.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    assert!(recovered.is_file(), "旧根的孤儿活动库必须被捞到新根");
    let (rows, verdict) = inspect_activity(&recovered).await;
    assert_eq!(rows, 3, "捞回来的必须是那份历史，不是空库");
    assert_eq!(verdict, "ok", "捞回来的库必须结构完好");
    assert!(
        legacy_activity.join(LEGACY_ACTIVITY_DB_FILE).is_file(),
        "旧根不删（搬迁只复制）"
    );
    assert!(
        !target.join("logs").exists(),
        "只补活动库：其余五项当年已经搬过，再搬一遍会覆盖新根里的新数据"
    );
    pool.close().await;
    std::fs::remove_dir_all(&legacy).ok();
    std::fs::remove_dir_all(&current).ok();
    std::fs::remove_dir_all(&appdata).ok();
    std::fs::remove_dir_all(&target).ok();
}

/// ② 当前根已经有活动库 → 不补：旧根那份可能更旧，覆盖过去就是让用户的历史倒退。
#[tokio::test]
async fn existing_activity_database_in_the_current_root_is_not_overwritten_by_the_orphan() {
    let legacy = support::unique_dir("patina-legacy-old2");
    let legacy_activity = legacy.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&legacy_activity).expect("建旧根活动数据目录");
    write_activity_db(&legacy_activity.join(LEGACY_ACTIVITY_DB_FILE), 5).await;

    let current = support::unique_dir("patina-legacy-current2");
    let pool = db::init_pool(&current).await.expect("建业务库");
    /* 当前根按**新**布局有库：这是 T05 之后的常态，也是「不许被旧根那份覆盖」的保护对象。 */
    let current_activity = current.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&current_activity).expect("建当前根活动数据目录");
    write_activity_db(&current_activity.join(SQLITE_DB_FILE_NAME), 1).await;
    let appdata = support::unique_dir("patina-legacy-appdata2");
    pointer_pointing_back(&appdata, &current, &legacy);

    let target = support::unique_dir("patina-legacy-new2");
    switch(&pool, &appdata, &current, &target.display().to_string())
        .await
        .expect("切换应成功");

    let copied = target.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let (rows, _) = inspect_activity(&copied).await;
    assert_eq!(
        rows, 1,
        "搬的必须是当前根那份；旧根那 5 行是更早的历史，不许覆盖回来"
    );
    pool.close().await;
    std::fs::remove_dir_all(&legacy).ok();
    std::fs::remove_dir_all(&current).ok();
    std::fs::remove_dir_all(&appdata).ok();
    std::fs::remove_dir_all(&target).ok();
}

/// **M-17（回滚窗口分支）**：旧根里**两套布局都在**时，取 mtime 较新的那一份。
///
/// 现场是真实会发生的：T05 迁移过 → 用户回滚到旧版本 → 旧版本继续写
/// `patina/data/patina.db` → 再升级回来。此时旧根里 `activity/data` 是「升级那一刻冻结
/// 的副本」、`patina/data` 是「回滚期间继续写的那份」。按「探到哪个用哪个」会取到冻结
/// 的那份 ⇒ 回滚期间写的历史静默消失。所以这里与约束 8 同口径：比 mtime，取较新。
#[tokio::test]
async fn when_the_old_root_has_both_layouts_the_newer_one_wins() {
    let legacy = support::unique_dir("patina-legacy-both");
    /* 冻结的那份：迁移时刻的副本，1 行。 */
    let frozen = legacy.join(ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&frozen).expect("建 activity/data");
    write_activity_db(&frozen.join(SQLITE_DB_FILE_NAME), 1).await;
    /* 回滚期间继续写的旧库：4 行，而且 mtime 更新。 */
    let rolled = legacy.join(LEGACY_ACTIVITY_DATA_REL);
    std::fs::create_dir_all(&rolled).expect("建 patina/data");
    let rolled_db = rolled.join(LEGACY_ACTIVITY_DB_FILE);
    write_activity_db(&rolled_db, 4).await;
    let later = std::time::SystemTime::now() + std::time::Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&rolled_db)
        .expect("打开旧库改 mtime")
        .set_modified(later)
        .expect("改 mtime");

    let current = support::unique_dir("patina-legacy-both-current");
    let pool = db::init_pool(&current).await.expect("建业务库");
    let appdata = support::unique_dir("patina-legacy-both-appdata");
    pointer_pointing_back(&appdata, &current, &legacy);

    let target = support::unique_dir("patina-legacy-both-new");
    switch(&pool, &appdata, &current, &target.display().to_string())
        .await
        .expect("切换应成功");

    let copied = target.join(ACTIVITY_DATA_REL).join(SQLITE_DB_FILE_NAME);
    let (rows, verdict) = inspect_activity(&copied).await;
    assert_eq!(
        rows, 4,
        "回滚窗口：必须取 mtime 较新的那份（回滚期间写的 4 行），否则这段历史静默消失"
    );
    assert_eq!(verdict, "ok");
    pool.close().await;
    std::fs::remove_dir_all(&legacy).ok();
    std::fs::remove_dir_all(&current).ok();
    std::fs::remove_dir_all(&appdata).ok();
    std::fs::remove_dir_all(&target).ok();
}
