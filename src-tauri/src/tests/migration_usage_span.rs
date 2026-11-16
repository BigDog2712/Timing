//! 迁移 0013（0.12.8）：清掉旧配对算法写下的碎段。
//!
//! 单独一个文件是因为 `migration.rs` 已经 295 行，撞 `check:size` 的 300 行上限
//! （与 `<svc>_tests.rs` 同一个处置）。这一段只验一件事：**版本推过去的同时，表真的被清空**。
//!
//! 为什么这条必须存在：`DELETE FROM app_usage_span` 写在一次性段里，一旦有人把它挪进
//! guard 段（每次启动都跑）或者误删，症状是「历史时段每次开页面都被抹掉」—— 而
//! `rollup` 会紧接着把当天的重新写回去，所以**当天的数据看起来完全正常**，只有往前翻
//! 才会发现段没了。不报错、不掉用例、只有用户能看见。

use sqlx::SqlitePool;

use crate::infra::db;
use crate::tests::support::{fresh_pool, scalar_i64, scalar_opt_str, unique_dir};

/// 建库 → 退版本号 → 用**同一目录**再 `init_pool` 一次（= 升级场景）→ 返回新池。
///
/// `init_pool` 就是「迁移入口」：它读 `schema.version` 决定跑哪些一次性段。
/// 同目录重开是 `migration_v2::v1_database_upgrades_in_place` 已经用过的路子。
async fn upgrade_with(tag: &str, seed: &[&str]) -> SqlitePool {
    let dir = unique_dir(tag);
    let pool = db::init_pool(&dir).await.expect("首次建库应成功");
    for sql in seed {
        sqlx::query(sql)
            .execute(&pool)
            .await
            .expect("造数据应成功");
    }
    /* 退回 12 = 模拟「0.12.7 的库刚升到 0.12.8」 */
    sqlx::query("UPDATE settings SET value = '12' WHERE key = 'schema.version'")
        .execute(&pool)
        .await
        .expect("退版本号应成功");
    pool.close().await;
    db::init_pool(&dir).await.expect("升级应成功")
}

const OLD_FRAGMENT: &str =
    "INSERT INTO app_usage_span (package_name, local_date, start_ms, end_ms, updated_at) \
     VALUES ('com.tencent.mm', '2026-11-15', 1000, 3000, 0)";
const DAILY_TOTAL: &str =
    "INSERT INTO app_usage (package_name, local_date, foreground_sec, first_seen_at, last_seen_at, updated_at) \
     VALUES ('com.tencent.mm', '2026-11-15', 3600, 1000, 2000, 0)";

#[tokio::test]
async fn usage_span_purge_clears_old_fragments_and_bumps_version() {
    let pool = upgrade_with("mig-usage-purge", &[OLD_FRAGMENT]).await;

    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM app_usage_span").await,
        0,
        "0013 必须清空 app_usage_span（旧碎段与新段起点不同，会并存成一张更乱的时间轴）"
    );
    let version = scalar_opt_str(&pool, "SELECT value FROM settings WHERE key = 'schema.version'")
        .await
        .expect("schema.version 应存在");
    /* 0013 自己把版本推到 13，0014（同步事件流）再推到 14 —— 这里跑的是**全部**迁移，
       所以看到的是最终值。要单独验 0013 的推进，得回到只有 0013 的那棵树。 */
    assert_eq!(version, "14", "全部迁移跑完版本必须推到 14（0013 → 13，0014 → 14）");
}

/// 反向：聚合表**不许**跟着被清。
///
/// `app_usage.foreground_sec` 取 MAX 写入，新口径的值更大，重扫会自己抬上去；
/// 清掉它等于把「系统明细已回收的那些日子」永久变成空白 —— 那时连重扫都扫不回来。
#[tokio::test]
async fn usage_span_purge_leaves_the_daily_totals_alone() {
    let pool = upgrade_with("mig-usage-purge-keep", &[DAILY_TOTAL, OLD_FRAGMENT]).await;

    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM app_usage_span").await,
        0,
        "段应被清空"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT foreground_sec FROM app_usage WHERE package_name = 'com.tencent.mm'"
        )
        .await,
        3600,
        "app_usage 的合计**不许**被这次清理波及"
    );
}

/* 从 `tests/migration.rs` 搬来（那边撞 300 行）：主键与读法索引都属时段表自己的事。 */
/// `app_usage_span` 必须真的建出来，且主键是 `(package_name, local_date, start_ms)`。
///
/// 这条钉的是「迁移写了但表没建」——表现是 `usage_stats_get` 每次写库都报
/// `no such table`（只在手机包里出现，桌面 `cargo test` 编不到那段 cfg 分支），
/// 而统计页只会变成一句「读不到应用数据」。
///
/// 主键含 `start_ms` 是「重复上报取 MAX」的前提：同一段重扫要靠它做 `ON CONFLICT`
/// 去重，少了它就会插进两条一模一样的区间，界面上「9:00-9:30」出现两遍。
#[tokio::test]
async fn usage_span_table_lands_with_expected_primary_key() {
    let pool = fresh_pool("mig-usage-span").await;
    let sql = scalar_opt_str(
        &pool,
        "SELECT sql FROM sqlite_master WHERE name = 'app_usage_span'",
    )
    .await
    .expect("迁移跑完应有 app_usage_span 表");
    let normalized = sql.to_lowercase().replace(['"', ' ', '\n', '\t'], "");
    assert!(
        normalized.contains("primarykey(package_name,local_date,start_ms)"),
        "app_usage_span 的主键必须是 (package_name, local_date, start_ms)，实际：{sql}"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'idx_app_usage_span_date'"
        )
        .await,
        1,
        "读法索引 idx_app_usage_span_date 必须存在"
    );
}
