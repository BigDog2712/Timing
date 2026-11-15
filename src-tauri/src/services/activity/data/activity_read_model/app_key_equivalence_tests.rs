//! 生成列 `app_key` 与 Rust 归一函数 `normalize_app_key` 的**逐字等价**。
//!
//! 迁移 28 ③ 把 12 处内联 `CASE … || '.exe'` 收敛成 3 个 VIRTUAL 生成列，于是同一条
//! 归一规则变成两份实现（Rust 函数 / SQL 表达式）。裁决 C 的「代价 2」要求这两份必须
//! 被钉住：只要漂一格，`recorded_app_catalog` 的键就会裂成 `code.exe` 与 `code` 两套，
//! 小时投影与应用列表各按一套聚合——数字对不上，而且**没有任何地方会报错**。
//!
//! 三条断言：
//! 1. 12 个夹具 × `sessions.app_key`；
//! 2. 同样 12 个 × `import_exact_sessions.app_key` 与 `import_time_buckets.app_key`
//!    （三段 DDL 是各自独立的拷贝，只测一张挡不住另外两张）；
//! 3. 本库里 `recorded_app_catalog` 的每一行：`normalize_app_key(raw_exe_name) == app_key`。
//!    生产库上这一条就是「98 条全等」的判据（见 `production_catalog_…`）。

use crate::models::activity::activity_read_model::normalize_app_key;
use crate::services::activity::data::hourly_fixture::setup_pool;
use sqlx::SqlitePool;

/// 夹具选择的是**分歧点**，不是随机样本：引号、首尾空白、大小写、有无 `.exe`、
/// 空串、纯空白、含 `:` 的完整键（`activity:anonymous` 与带盘符的路径）、CJK、
/// 双后缀、点号结尾。其中任何一条在 SQL 里写成 `LOWER(TRIM(exe_name))` 就会分叉。
const FIXTURES: [&str; 12] = [
    "Code.EXE",
    "  \"Code.EXE\"  ",
    "code",
    "code.exe",
    "",
    "   ",
    "activity:anonymous",
    "C:\\Program Files\\Zoom\\Zoom.exe",
    "微信",
    "App.EXE.exe",
    "trailing.",
    "\"quoted name\"",
];

#[tokio::test]
async fn generated_columns_match_the_rust_normalizer_for_every_fixture() {
    let pool = setup_pool().await;
    sqlx::query(
        "INSERT INTO import_batches(id, imported_at, source_name, source_kind, source_fingerprint)
         VALUES ('b1', 0, 'fixture', 'csv', 'fixture-fingerprint')",
    )
    .execute(&pool)
    .await
    .unwrap();
    for (index, fixture) in FIXTURES.into_iter().enumerate() {
        let expected = normalize_app_key(fixture).unwrap_or_default();
        assert_eq!(
            sessions_app_key(&pool, fixture).await,
            expected,
            "sessions.app_key for {fixture:?}"
        );
        assert_eq!(
            import_app_keys(&pool, fixture, index).await,
            (expected.clone(), expected),
            "import_*.app_key for {fixture:?}"
        );
    }
    pool.close().await;
}

/// 本库 `recorded_app_catalog` 的每一行都必须能被 Rust 函数原样重算出来。
///
/// 在夹具库上它同时验证「目录写侧用的就是 `normalize_app_key`」；把这条用例指到生产库
/// （`TIMING_PARITY_DB`）跑，就是裁决 C 要求的「98 条现值全等」。
#[tokio::test]
async fn recorded_app_catalog_keys_recompute_to_themselves() {
    let pool = setup_pool().await;
    for fixture in FIXTURES {
        // `end_time` 必须给：迁移 28 之后「每设备一条进行中」的唯一索引会让
        // 第二条 `end_time IS NULL` 的行直接失败。
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
             VALUES ('', ?, 0, 1000, 1000)",
        )
        .bind(fixture)
        .execute(&pool)
        .await
        .unwrap();
    }
    super::catalog::maintain_once(&pool).await.unwrap();
    let rows: Vec<(String, String)> =
        sqlx::query_as("SELECT app_key, raw_exe_name FROM recorded_app_catalog ORDER BY app_key")
            .fetch_all(&pool)
            .await
            .unwrap();
    assert!(
        !rows.is_empty(),
        "catalog fixture produced no rows; the assertion below would be vacuous"
    );
    assert_recompute_equals_stored(&rows);
    pool.close().await;
}

/// 生产库版本（`#[ignore]`：要有人明确指一个库才会跑）。
///
/// 跑法：
/// ```text
/// TIMING_PARITY_DB=D:/tmp/p1.db \
///   cargo +1.100.0 test --lib production_catalog -- --ignored --nocapture
/// ```
#[test]
#[ignore = "reads a real database via TIMING_PARITY_DB; run with --ignored"]
fn production_catalog_keys_recompute_to_themselves() {
    let path = std::env::var("TIMING_PARITY_DB").expect("TIMING_PARITY_DB must point at a patina.db");
    tauri::async_runtime::block_on(async {
        let pool =
            crate::services::activity::data::sqlite_pool::open_single_connection_sqlite_pool(
                std::path::Path::new(&path),
                false,
            )
            .await
            .unwrap();
        let rows: Vec<(String, String)> =
            sqlx::query_as("SELECT app_key, raw_exe_name FROM recorded_app_catalog ORDER BY app_key")
                .fetch_all(&pool)
                .await
                .unwrap();
        println!("recorded_app_catalog rows = {}", rows.len());
        assert_recompute_equals_stored(&rows);
        pool.close().await;
    });
}

fn assert_recompute_equals_stored(rows: &[(String, String)]) {
    let mismatched: Vec<(&str, &str)> = rows
        .iter()
        .filter(|(app_key, raw_exe_name)| {
            normalize_app_key(raw_exe_name).unwrap_or_default() != *app_key
        })
        .map(|(app_key, raw_exe_name)| (app_key.as_str(), raw_exe_name.as_str()))
        .collect();
    assert!(
        mismatched.is_empty(),
        "{} of {} catalog keys disagree with normalize_app_key: {mismatched:?}",
        mismatched.len(),
        rows.len()
    );
}

async fn sessions_app_key(pool: &SqlitePool, exe_name: &str) -> String {
    let inserted = sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('', ?, 0, 1000, 1000)",
    )
    .bind(exe_name)
    .execute(pool)
    .await
    .unwrap();
    sqlx::query_scalar("SELECT app_key FROM sessions WHERE id = ?")
        .bind(inserted.last_insert_rowid())
        .fetch_one(pool)
        .await
        .unwrap()
}

async fn import_app_keys(pool: &SqlitePool, exe_name: &str, index: usize) -> (String, String) {
    let exact = sqlx::query(
        "INSERT INTO import_exact_sessions(
           batch_id, fingerprint, app_name, exe_name, start_time, end_time, duration
         ) VALUES ('b1', ?, '', ?, 0, 1000, 1000)",
    )
    .bind(format!("exact-{index}"))
    .bind(exe_name)
    .execute(pool)
    .await
    .unwrap();
    let bucket = sqlx::query(
        "INSERT INTO import_time_buckets(batch_id, fingerprint, app_name, exe_name,
           bucket_start_time, duration) VALUES ('b1', ?, '', ?, 0, 60000)",
    )
    .bind(format!("bucket-{index}"))
    .bind(exe_name)
    .execute(pool)
    .await
    .unwrap();
    let exact_key = sqlx::query_scalar("SELECT app_key FROM import_exact_sessions WHERE id = ?")
        .bind(exact.last_insert_rowid())
        .fetch_one(pool)
        .await
        .unwrap();
    let bucket_key = sqlx::query_scalar("SELECT app_key FROM import_time_buckets WHERE id = ?")
        .bind(bucket.last_insert_rowid())
        .fetch_one(pool)
        .await
        .unwrap();
    (exact_key, bucket_key)
}
