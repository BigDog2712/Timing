//! [批 2 · 第 5 项] **真机数据**上的导出往返（`#[ignore]`：只有本机能跑）。
//!
//! 存在的理由：fixture 库再像，也只是十几行。真机上写死的两个数字 ——
//! `SELECT COUNT(*) FROM items`（含软删）与活动库 `sessions` 的 14770 行 ——
//! 才是「全量导出没漏表、没截断」的判据。跑法（**只读**打开两个库）：
//!
//! ```text
//! cargo test --lib -- --ignored bundle_real
//! ```
//!
//! 缺库就安静跳过（CI / 新机器没有 `%APPDATA%\com.timing.app`）。

use crate::infra::activity::storage_paths;
use crate::services::activity::data::bundle::{export_full_bundle, inspect_file};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::path::{Path, PathBuf};

/// 与 `services::activity::data::bundle` 的两张清单逐字一致（那份是 `pub(crate)`，
/// 这里抄一份是为了让断言「每张表都被处理过」自己就能读，不靠被测代码自证）。
const BUSINESS_TABLES: &[&str] = &[
    "items",
    "item_app",
    "time_records",
    "timer_ops",
    "todos",
    "notes",
    "sync_tombstone",
    "app_usage",
    "settings",
];
const ACTIVITY_TABLES: &[&str] = &[
    "app_category",
    "focus_blocks",
    "sessions",
    "icon_cache",
    "settings",
];

fn data_root() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let root = PathBuf::from(appdata).join("com.timing.app");
    root.is_dir().then_some(root)
}

/// 只读打开（`mode=ro`）：这条用例绝不能碰用户的库。
async fn open_read_only(path: &Path) -> Option<Pool<Sqlite>> {
    if !path.is_file() {
        return None;
    }
    let options = SqliteConnectOptions::new()
        .filename(path)
        .read_only(true)
        .busy_timeout(std::time::Duration::from_secs(5));
    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .ok()
}

/// 活动库在真机数据根下的路径。
///
/// `"patina"` 是**落盘坐标**（活动子系统在数据根下的目录名，T05 才动）；`data` 与库名
/// 走 `storage_paths` 的常量 —— 夹具自己再写一份 `"patina.db"` 的话，改名那个提交里
/// 夹具会继续指向老路径，于是「真机往返」这条判据静默变成「缺库跳过」。
fn activity_db_path(root: &Path) -> PathBuf {
    root.join("patina")
        .join(storage_paths::DATA_SUBDIR)
        .join(storage_paths::SQLITE_DB_FILE_NAME)
}

async fn count(pool: &Pool<Sqlite>, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("`{sql}` 数不出来：{error}"))
}

#[tokio::test]
#[ignore = "需要真机库；手动 npm/ cargo test --lib -- --ignored bundle_real"]
async fn bundle_real_counts_match_the_live_databases() {
    let Some(root) = data_root() else {
        println!("跳过：没有 %APPDATA%\\com.timing.app");
        return;
    };
    let (Some(business), Some(activity)) = (
        open_read_only(&root.join("timing.db")).await,
        open_read_only(&activity_db_path(&root)).await,
    ) else {
        println!("跳过：两个库没有同时存在");
        return;
    };

    let target = std::env::temp_dir().join("timing-bundle-real-check.json");
    let summary = export_full_bundle(&business, &activity, &target, "real-check")
        .await
        .expect("真机导出应成功");
    let parsed: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&target).expect("读包")).expect("包必须是合法 JSON");

    assert_eq!(parsed["format"], "timing.full-bundle.v1");

    /* 判据 1：逐表行数与 `COUNT(*)` 逐字相等（导出是全量，含软删）。 */
    for table in [
        "items",
        "item_app",
        "time_records",
        "timer_ops",
        "todos",
        "notes",
        "sync_tombstone",
        "app_usage",
    ] {
        let expected = count(&business, &format!("SELECT COUNT(*) FROM {table}")).await;
        let actual = parsed["business"][table]
            .as_array()
            .map(|rows| rows.len() as i64)
            .unwrap_or(0);
        assert_eq!(actual, expected, "business.{table} 行数不符");
    }
    for table in ["app_category", "focus_blocks", "sessions", "icon_cache"] {
        let expected = count(&activity, &format!("SELECT COUNT(*) FROM {table}")).await;
        let actual = parsed["activity"][table]
            .as_array()
            .map(|rows| rows.len() as i64)
            .unwrap_or(0);
        assert_eq!(actual, expected, "activity.{table} 行数不符");
    }

    /* 判据 2：能被预览读回，且总行数等于导出时统计的行数。 */
    let preview = inspect_file(&target).expect("预览应成功");
    assert!(preview.compatible);
    assert_eq!(preview.total_rows, summary.row_count);
    println!(
        "真机往返：{} 张表 / {} 行 / {} 字节",
        summary.table_count, summary.row_count, summary.bytes
    );

    let _ = std::fs::remove_file(&target);
}

/// 同一份**真机包**导进一个新库：判据 3 的真机版本（fixture 那份只覆盖十几行）。
///
/// 这里最容易炸的三处，全部来自「真数据才会有」的形状：
/// · `sessions` 的**生成列** `app_key`（`INSERT` 进去直接报错）；
/// · `items` 的**默认种子行** uid 为空 → 先合成 uid 再走 uid upsert（不再按 id 撞车）；
/// · `todos` / `notes` 没有唯一索引 → 只能按 id 忽略，明细里要记成 `skipped`。
#[tokio::test]
#[ignore = "需要真机库；手动 cargo test --lib -- --ignored bundle_real"]
async fn a_real_bundle_imports_into_a_fresh_database() {
    let Some(root) = data_root() else {
        println!("跳过：没有 %APPDATA%\\com.timing.app");
        return;
    };
    let (Some(business), Some(activity)) = (
        open_read_only(&root.join("timing.db")).await,
        open_read_only(&activity_db_path(&root)).await,
    ) else {
        println!("跳过：两个库没有同时存在");
        return;
    };
    let target = std::env::temp_dir().join("timing-bundle-real-import.json");
    export_full_bundle(&business, &activity, &target, "real-check")
        .await
        .expect("真机导出应成功");
    let package: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&target).expect("读包")).expect("包必须是合法 JSON");

    let fresh_business = crate::tests::support::fresh_pool("bundle-real-import").await;
    let fresh_activity = crate::tests::bundle::activity_pool("bundle-real-import-act")
        .await
        .0;
    let result = crate::services::activity::data::bundle::import_full_bundle(
        &fresh_business,
        &fresh_activity,
        &target,
    )
    .await;
    let result = match result {
        Ok(summary) => summary,
        Err(error) => panic!("真机包导入失败：{error}"),
    };
    assert!(result.total_inserted > 0);

    /* 每张表：新增 + 更新 + 跳过 == 包里的行数（一行都不许凭空消失）。 */
    for (section, tables) in [("business", BUSINESS_TABLES), ("activity", ACTIVITY_TABLES)] {
        for name in tables {
            let packed = package[section][name]
                .as_array()
                .map(|rows| rows.len() as u64)
                .unwrap_or(0);
            let stat = result
                .tables
                .iter()
                .find(|stat| stat.name == format!("{section}.{name}"))
                .unwrap_or_else(|| panic!("缺少 {section}.{name} 的统计"));
            assert_eq!(
                stat.inserted + stat.updated + stat.skipped,
                packed,
                "{section}.{name} 有行没被处理（包 {packed} 行）"
            );
        }
    }

    /* 判据 ①（原话是「导入后 `SELECT COUNT(*) FROM items WHERE uid IS NULL` = 0」，实现
    口径要说清楚）：新装库自带一条种子事项（`id=1`、`uid` 空、`device_id` 空串），
    它不是导入产生的 —— 所以「= 0」唯一能成立的形态是**除种子外为 0**。
    种子这一行为什么至今仍空：这条用例的库来自 `support::fresh_pool`，它**只跑迁移**，
    而认领（`services::device::startup_business_identity` → `adopt_business_rows`）挂在
    `app::bootstrap` 上，本用例没有走那条路。注意认领现已覆盖 `items`
    （`BUSINESS_UID_ADOPTIONS`）：一旦这里接上启动流程，「= 1」就得改成「= 0」。
    合成 uid 上线后，包里的每一行都拿到了 `i:<包里 deviceId>:<包里的原始 id>`
    （真机那批事项的 uid 在修好写入点之前全是 NULL）。 */
    let packed_items = package["business"]["items"]
        .as_array()
        .map(|rows| rows.len() as i64)
        .unwrap_or(0);
    assert_eq!(
        count(
            &fresh_business,
            "SELECT COUNT(*) FROM items WHERE uid IS NULL"
        )
        .await,
        1,
        "导入产生了 uid 为空的事项（除本机种子外应为 0）",
    );
    assert_eq!(
        count(
            &fresh_business,
            "SELECT COUNT(*) FROM items WHERE uid IS NULL AND id <> 1",
        )
        .await,
        0,
        "除种子外不该再有 uid 为空的事项",
    );
    /* 一条都没被静默丢掉：包里多少条事项，就有多少条拿到合成 uid。 */
    assert_eq!(
        count(
            &fresh_business,
            "SELECT COUNT(*) FROM items WHERE uid LIKE 'i:real-check:%'",
        )
        .await,
        packed_items,
        "包里 {packed_items} 条事项都该拿到合成 uid",
    );
    /* 判据 ②（真机版）：同一份包再导一次 —— 一行不插、**一行不改**。
    「不改」这一半靠 uid 类表的「内容没变就不写」守卫：否则 touch 触发器会把
    每一行的 `updated_at_ms` 推到「现在」，1.5 万行全部变成脏行。 */
    let second = crate::services::activity::data::bundle::import_full_bundle(
        &fresh_business,
        &fresh_activity,
        &target,
    )
    .await
    .expect("第二次导入应成功");
    assert_eq!(
        second.total_inserted, 0,
        "第二次不应再插行：{:?}",
        second.tables
    );
    assert_eq!(
        second.total_updated, 0,
        "第二次不应再改行：{:?}",
        second.tables
    );
    let sessions: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM sessions")
        .fetch_one(&fresh_activity)
        .await
        .expect("数导入后的活动行");
    assert_eq!(
        sessions as u64,
        package["activity"]["sessions"]
            .as_array()
            .map(|r| r.len() as u64)
            .unwrap_or(0),
    );
    println!(
        "真机导入：新增 {} 行 / 更新 {} 行",
        result.total_inserted, result.total_updated
    );
    let _ = std::fs::remove_file(&target);
}
