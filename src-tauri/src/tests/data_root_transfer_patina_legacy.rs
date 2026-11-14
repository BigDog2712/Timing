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

use crate::infra::db;
use crate::infra::root_pointer;
use crate::services::data_root::switch;
use crate::tests::data_root_transfer_patina::{inspect_activity, write_activity_db};
use crate::tests::support;

/// 造一个「旧版搬过、`patina/data` 留在旧根」的现场：`appdata` 里的指针
/// `dataDir = current`、`previous = legacy`。
fn pointer_pointing_back(appdata: &std::path::Path, current: &std::path::Path, legacy: &std::path::Path) {
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
    let legacy_activity = legacy.join("patina").join("data");
    std::fs::create_dir_all(&legacy_activity).expect("建旧根 patina/data");
    write_activity_db(&legacy_activity.join("patina.db"), 3).await;
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

    let recovered = target.join("patina").join("data").join("patina.db");
    assert!(recovered.is_file(), "旧根的孤儿活动库必须被捞到新根");
    let (rows, verdict) = inspect_activity(&recovered).await;
    assert_eq!(rows, 3, "捞回来的必须是那份历史，不是空库");
    assert_eq!(verdict, "ok", "捞回来的库必须结构完好");
    assert!(
        legacy_activity.join("patina.db").is_file(),
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
    let legacy_activity = legacy.join("patina").join("data");
    std::fs::create_dir_all(&legacy_activity).expect("建旧根 patina/data");
    write_activity_db(&legacy_activity.join("patina.db"), 5).await;

    let current = support::unique_dir("patina-legacy-current2");
    let pool = db::init_pool(&current).await.expect("建业务库");
    let current_activity = current.join("patina").join("data");
    std::fs::create_dir_all(&current_activity).expect("建当前根 patina/data");
    write_activity_db(&current_activity.join("patina.db"), 1).await;
    let appdata = support::unique_dir("patina-legacy-appdata2");
    pointer_pointing_back(&appdata, &current, &legacy);

    let target = support::unique_dir("patina-legacy-new2");
    switch(&pool, &appdata, &current, &target.display().to_string())
        .await
        .expect("切换应成功");

    let copied = target.join("patina").join("data").join("patina.db");
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
