//! V0.2.0 批 1（A1）：v1 -> v2 迁移。
//!
//! 断言来源：`docs/phase2/schema-V0.2.0.sql`、`ARCHITECTURE-V0.2.0 §4.5`、`Spec §6`。
//! 覆盖：补列（ensure_column）/ 新表 / 新索引 / settings 种子 / 版本推进 / **真实 v1 库就地升级 + 幂等**。
//!
//! 与 `tests/migration.rs`（V0.1.0 迁移与约束）分文件，遵守「单文件 ≤300 有效行」。

use sqlx::SqlitePool;

use crate::infra::db;
use crate::tests::support::{fresh_pool, scalar_i64, scalar_opt_str, unique_dir};

/// 表是否存在。
async fn has_table(pool: &SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("查询 sqlite_master 应成功")
        == 1
}

/// 列是否存在（`PRAGMA table_info`，与迁移守卫同口径）。
async fn has_column(pool: &SqlitePool, table: &str, column: &str) -> bool {
    use sqlx::Row;
    let rows = sqlx::query(&format!("PRAGMA table_info({table})"))
        .fetch_all(pool)
        .await
        .expect("PRAGMA table_info 应成功");
    rows.iter()
        .any(|row| row.get::<String, _>("name") == column)
}

/// 索引是否存在。
async fn has_index(pool: &SqlitePool, name: &str) -> bool {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("查询 sqlite_master 应成功")
        == 1
}

async fn setting_value(pool: &SqlitePool, key: &str) -> Option<String> {
    let sql = format!("SELECT value FROM settings WHERE key = '{key}'");
    scalar_opt_str(pool, &sql).await
}

#[tokio::test]
async fn v2_columns_added_to_existing_tables() {
    let pool = fresh_pool("mig-v2cols").await;
    for (table, column) in [
        ("items", "remind_at"),
        ("items", "reminded_at"),
        ("items", "is_pinned"),
        ("time_records", "mode"),
        ("time_records", "target_sec"),
    ] {
        assert!(
            has_column(&pool, table, column).await,
            "{table}.{column} 应存在（V0.2.0 加列）"
        );
    }
}

#[tokio::test]
async fn v2_new_tables_and_indexes_created() {
    let pool = fresh_pool("mig-v2tables").await;
    for t in ["notes", "todos"] {
        assert!(has_table(&pool, t).await, "表 {t} 应存在");
    }
    for idx in [
        "idx_items_remind",
        "idx_notes_item_id",
        "idx_notes_open",
        "idx_todos_done",
        "idx_todos_planned",
        "idx_todos_remind",
    ] {
        assert!(has_index(&pool, idx).await, "索引 {idx} 应存在");
    }
}

#[tokio::test]
async fn v2_settings_seeded_and_version_bumped() {
    let pool = fresh_pool("mig-v2seed").await;
    for (key, value) in [
        ("theme.mode", "\"dark\""),
        ("accent.running", "\"#4DA3E8\""),
        ("accent.warn", "\"#E8A33D\""),
        ("accent.done", "\"#4CC38A\""),
        ("accent.bar", "null"),
        ("countdown.presets", "[300,900,1500,1800,2700,3600]"),
    ] {
        assert_eq!(
            setting_value(&pool, key).await.as_deref(),
            Some(value),
            "settings[{key}] 种子应为 {value}"
        );
    }
    assert_eq!(
        setting_value(&pool, "schema.version").await.as_deref(),
        Some("4")
    );
}

/// 真实 v1 库升级：仅跑 0001（v1 schema），再执行完整迁移 —— 验证加列 / 建表 / 版本推进 / 幂等。
#[tokio::test]
async fn v1_database_upgrades_in_place() {
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};

    let dir = unique_dir("mig-v1-upgrade");
    std::fs::create_dir_all(&dir).expect("建临时目录应成功");
    let options = SqliteConnectOptions::new()
        .filename(dir.join("timing.db"))
        .create_if_missing(true);
    let pool = SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(options)
        .await
        .expect("连接 v1 库应成功");

    // ① 构造纯 v1 库（仅 0001）
    sqlx::raw_sql(include_str!("../migrations/0001_init.sql"))
        .execute(&pool)
        .await
        .expect("执行 0001 应成功");
    assert!(
        !has_column(&pool, "items", "remind_at").await,
        "v1 不应有 items.remind_at"
    );
    assert!(
        !has_column(&pool, "time_records", "mode").await,
        "v1 不应有 time_records.mode"
    );
    assert!(!has_table(&pool, "notes").await, "v1 不应有 notes 表");
    assert_eq!(
        setting_value(&pool, "schema.version").await.as_deref(),
        Some("1")
    );

    // ② 升级 v1 -> v2
    crate::infra::migrate::migrate(&pool)
        .await
        .expect("v1 -> v2 迁移应成功");
    assert!(
        has_column(&pool, "items", "remind_at").await,
        "升级后应补 items.remind_at"
    );
    assert!(
        has_column(&pool, "time_records", "mode").await,
        "升级后应补 time_records.mode"
    );
    assert!(has_table(&pool, "notes").await, "升级后应建 notes 表");
    assert!(has_table(&pool, "todos").await, "升级后应建 todos 表");
    assert!(
        has_column(&pool, "notes", "is_pinned").await,
        "升级后应补 notes.is_pinned（v3，ADR-019）"
    );
    assert!(
        has_column(&pool, "todos", "remind_stage").await,
        "升级后应补 todos.remind_stage（v4，ADR-030）"
    );
    assert!(
        has_column(&pool, "todos", "auto_start").await,
        "升级后应补 todos.auto_start（v4，ADR-030）"
    );
    assert_eq!(
        setting_value(&pool, "schema.version").await.as_deref(),
        Some("4")
    );

    // ③ 再跑一次仍不报错（K-13 幂等），且种子不重复
    crate::infra::migrate::migrate(&pool)
        .await
        .expect("重复迁移应幂等");
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE id = 1").await,
        1
    );
}

/// 幂等：同一目录连跑两次 `init_pool` 不报错，版本稳定为 4。
#[tokio::test]
async fn init_pool_is_idempotent_at_v2() {
    let dir = unique_dir("mig-v2-idem");
    let p1 = db::init_pool(&dir).await.expect("首次迁移应成功");
    drop(p1);
    let p2 = db::init_pool(&dir).await.expect("重复迁移应成功");
    assert_eq!(
        setting_value(&p2, "schema.version").await.as_deref(),
        Some("4")
    );
    assert_eq!(
        scalar_i64(&p2, "SELECT COUNT(*) FROM items WHERE id = 1").await,
        1
    );
}
