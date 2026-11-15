//! 真机库上的认领验收（`#[ignore]`：只有本机能跑）。
//!
//! ## 它回答的问题
//!
//! 「`items` 那批 `uid` 全 NULL 的历史行，升级后第一次启动会不会真的拿到 `i:` 身份？」
//! fixture 库只能证明代码路径通，证明不了**真数据**的形状（22 行全是哨兵 `''`、
//! 且 `uq_items_uid` 上没有历史冲突）。这条用例拿真库的**副本**跑一遍认领。
//!
//! ## 安全边界（硬约束）
//!
//! · 原库**只读**：`std::fs::copy` 取副本，原文件全程不被打开写入；
//! · 只写副本：迁移 + 认领都发生在临时目录里，跑完连副本一起留在 temp（不删，便于肉眼核账）；
//! · `-wal` / `-shm` 一起拷贝：只拷主文件会漏掉还在 WAL 里的行，「22 行」这个数字就对不上。
//!
//! 跑法：
//!
//! ```text
//! cargo test --lib -- --ignored business_uid_real
//! ```

use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Sqlite};
use std::path::PathBuf;

/// 真机数据目录（与应用同一口径：`%APPDATA%\com.timing.app`）。
fn data_dir() -> Option<PathBuf> {
    let appdata = std::env::var_os("APPDATA")?;
    let root = PathBuf::from(appdata).join("com.timing.app");
    root.is_dir().then_some(root)
}

/// 把真库连同 WAL/SHM 一起拷进临时目录，返回副本路径（原库只读）。
fn copy_to_temp(source: &std::path::Path) -> PathBuf {
    let dir = crate::tests::support::unique_dir("business-uid-real");
    std::fs::create_dir_all(&dir).expect("建临时目录");
    let target = dir.join("timing.db");
    std::fs::copy(source, &target).expect("拷主库");
    for suffix in ["-wal", "-shm"] {
        let from = PathBuf::from(format!("{}{suffix}", source.display()));
        if from.is_file() {
            let to = PathBuf::from(format!("{}{suffix}", target.display()));
            std::fs::copy(&from, &to).expect("拷 WAL/SHM");
        }
    }
    target
}

async fn count(pool: &Pool<Sqlite>, sql: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(sql)
        .fetch_one(pool)
        .await
        .unwrap_or_else(|error| panic!("`{sql}` 数不出来：{error}"))
}

/// 认领前后逐表数一遍：`uid IS NULL` 与 `device_id = ''` 都必须归零。
#[tokio::test]
#[ignore = "需要真机库；手动 cargo test --lib -- --ignored business_uid_real"]
async fn a_real_business_database_gets_its_item_uids_backfilled() {
    let Some(root) = data_dir() else {
        println!("跳过：没有 %APPDATA%\\com.timing.app");
        return;
    };
    let source = root.join("timing.db");
    if !source.is_file() {
        println!("跳过：没有 timing.db");
        return;
    }
    let copy = copy_to_temp(&source);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(SqliteConnectOptions::new().filename(&copy))
        .await
        .expect("打开副本");

    /* 表的形状因库而异（很老的库可能还缺 items.uid），先把库带到 head。 */
    crate::infra::migrate::migrate(&pool).await.expect("迁移副本");

    const TABLES: &[(&str, &str)] = &[
        ("items", "i:"),
        ("time_records", "t:"),
        ("item_app", "b:"),
        ("timer_ops", "p:"),
    ];
    println!("真库副本：{}", copy.display());
    let mut before = Vec::new();
    for (table, _) in TABLES {
        let rows = count(&pool, &format!("SELECT COUNT(*) FROM {table}")).await;
        let nulls = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE uid IS NULL"),
        )
        .await;
        let sentinels = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE device_id = ''"),
        )
        .await;
        println!("认领前 {table}: {rows} 行 / uid NULL {nulls} / device_id '' {sentinels}");
        before.push((rows, nulls, sentinels));
    }

    let install_id = crate::services::device::startup_business_identity(&pool)
        .await
        .expect("启动认领应成功");
    println!("认领到设备 {install_id}");

    for (index, (table, prefix)) in TABLES.iter().enumerate() {
        let (rows_before, _, _) = before[index];
        let rows = count(&pool, &format!("SELECT COUNT(*) FROM {table}")).await;
        let nulls = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE uid IS NULL"),
        )
        .await;
        let sentinels = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE device_id = ''"),
        )
        .await;
        let shaped = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE uid LIKE '{prefix}%'"),
        )
        .await;
        println!(
            "认领后 {table}: {rows} 行 / uid NULL {nulls} / device_id '' {sentinels} / \
             `{prefix}` 形状 {shaped}"
        );
        assert_eq!(nulls, 0, "{table} 仍有人没有 uid（回填漏了这张表？）");
        assert_eq!(sentinels, 0, "{table} 仍有人没有属主");
        assert_eq!(shaped, rows, "{table} 的 uid 前缀不是 `{prefix}`");
        /* 认领只补列，不许增删行：真数据被改坏是这条用例最该抓的东西。 */
        assert_eq!(rows, rows_before, "{table} 的行数被认领改变了");
    }

    /* 幂等：再来一次启动，什么都不变（否则每次开机都把全库推成脏行）。 */
    let again = crate::services::device::startup_business_identity(&pool)
        .await
        .expect("第二次认领应成功");
    assert_eq!(again, install_id);
    for (table, _) in TABLES {
        let nulls = count(
            &pool,
            &format!("SELECT COUNT(*) FROM {table} WHERE uid IS NULL"),
        )
        .await;
        assert_eq!(nulls, 0, "{table} 第二次认领后出现了空 uid");
    }
}
