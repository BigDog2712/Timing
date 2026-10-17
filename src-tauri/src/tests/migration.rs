//! 迁移与数据层约束（Spec §6 / schema.sql）。
//! 验证：建表 + 种子「未归类」+ 6 索引（含部分唯一索引）+ 迁移幂等 + 四条 CHECK 不变式 + 外键。

use sqlx::SqlitePool;

use crate::infra::db;
use crate::tests::support::{fresh_pool, scalar_i64, scalar_opt_str, unique_dir};

async fn table_exists(pool: &SqlitePool, name: &str) -> i64 {
    sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?",
    )
    .bind(name)
    .fetch_one(pool)
    .await
    .expect("查询 sqlite_master 应成功")
}

#[tokio::test]
async fn three_tables_created() {
    let pool = fresh_pool("mig-tables").await;
    for t in ["items", "time_records", "settings"] {
        assert_eq!(table_exists(&pool, t).await, 1, "表 {t} 应存在");
    }
}

#[tokio::test]
async fn seed_system_item_uncategorized() {
    let pool = fresh_pool("mig-seed").await;
    assert_eq!(
        scalar_i64(&pool, "SELECT COUNT(*) FROM items WHERE id = 1").await,
        1
    );
    assert_eq!(
        scalar_i64(&pool, "SELECT is_system FROM items WHERE id = 1").await,
        1
    );
    assert_eq!(
        scalar_i64(&pool, "SELECT sort_order FROM items WHERE id = 1").await,
        0
    );
    assert_eq!(
        scalar_opt_str(&pool, "SELECT status FROM items WHERE id = 1")
            .await
            .as_deref(),
        Some("active")
    );
    assert_eq!(
        scalar_opt_str(&pool, "SELECT name FROM items WHERE id = 1")
            .await
            .as_deref(),
        Some("未归类")
    );
    // schema 版本登记：V0.2.0 批 1 迁移后推进到 2（K-7 / Spec §6 迁移铁律）
    assert_eq!(
        scalar_opt_str(
            &pool,
            "SELECT value FROM settings WHERE key = 'schema.version'"
        )
        .await
        .as_deref(),
        Some("2")
    );
}

#[tokio::test]
async fn six_indexes_and_partial_unique_open() {
    let pool = fresh_pool("mig-index").await;
    let expected = [
        "idx_items_status",
        "idx_records_item_id",
        "idx_records_started_at",
        "idx_records_item_started",
        "idx_records_status",
        "uq_records_open",
    ];
    for idx in expected {
        let n = sqlx::query_scalar::<_, i64>(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'index' AND name = ?",
        )
        .bind(idx)
        .fetch_one(&pool)
        .await
        .unwrap();
        assert_eq!(n, 1, "索引 {idx} 应存在");
    }
    // uq_records_open 必须是「仅 active」的部分唯一索引
    let sql = scalar_opt_str(
        &pool,
        "SELECT sql FROM sqlite_master WHERE name = 'uq_records_open'",
    )
    .await
    .expect("应有 uq_records_open 定义");
    let normalized = sql.to_lowercase().replace(['"', ' '], "");
    assert!(
        normalized.contains("wherestatus='active'"),
        "uq_records_open 应为 WHERE status='active' 的部分索引，实际：{sql}"
    );
}

#[tokio::test]
async fn migration_is_idempotent() {
    let dir = unique_dir("mig-idem");
    let p1 = db::init_pool(&dir).await.expect("首次迁移应成功");
    drop(p1);
    let p2 = db::init_pool(&dir)
        .await
        .expect("重复迁移应成功（IF NOT EXISTS）");
    // 种子行因 INSERT OR IGNORE 不会重复
    assert_eq!(
        scalar_i64(&p2, "SELECT COUNT(*) FROM items WHERE id = 1").await,
        1
    );
}

async fn insert_active(
    pool: &SqlitePool,
    item_id: i64,
) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
    sqlx::query(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, updated_at) \
         VALUES (?, 'active', 1000, NULL, 0, 1000, 1000, 1000)",
    )
    .bind(item_id)
    .execute(pool)
    .await
}

#[tokio::test]
async fn unique_active_session_enforced() {
    let pool = fresh_pool("mig-active-unique").await;
    insert_active(&pool, 1).await.expect("第一条 active 应成功");
    let second = insert_active(&pool, 1).await;
    assert!(second.is_err(), "第二条 active 应被 uq_records_open 拒绝");
}

#[tokio::test]
async fn check_active_implies_ended_null() {
    let pool = fresh_pool("mig-check-consistency").await;
    // status='active' 但 ended_at 非空 → 违反 CHECK
    let bad = sqlx::query(
        "INSERT INTO time_records (item_id,status,started_at,ended_at,accumulated_sec,created_at,updated_at) \
         VALUES (1,'active',1000,2000,0,1000,1000)",
    )
    .execute(&pool)
    .await;
    assert!(
        bad.is_err(),
        "(status='active') = (ended_at IS NULL) 约束应生效"
    );
}

#[tokio::test]
async fn check_ended_not_before_started() {
    let pool = fresh_pool("mig-check-duration").await;
    let bad = sqlx::query(
        "INSERT INTO time_records (item_id,status,started_at,ended_at,accumulated_sec,created_at,updated_at) \
         VALUES (1,'saved',5000,1000,0,5000,5000)",
    )
    .execute(&pool)
    .await;
    assert!(bad.is_err(), "ended_at >= started_at 约束应生效");
}

#[tokio::test]
async fn check_accumulated_non_negative() {
    let pool = fresh_pool("mig-check-accum").await;
    let bad = sqlx::query(
        "INSERT INTO time_records (item_id,status,started_at,ended_at,accumulated_sec,created_at,updated_at) \
         VALUES (1,'saved',1000,2000,-1,1000,1000)",
    )
    .execute(&pool)
    .await;
    assert!(bad.is_err(), "accumulated_sec >= 0 约束应生效");
}

#[tokio::test]
async fn foreign_key_enforced() {
    let pool = fresh_pool("mig-fk").await;
    let bad = sqlx::query(
        "INSERT INTO time_records (item_id,status,started_at,ended_at,accumulated_sec,created_at,updated_at) \
         VALUES (9999,'saved',1000,2000,0,1000,1000)",
    )
    .execute(&pool)
    .await;
    assert!(
        bad.is_err(),
        "外键 items(id) 应生效（PRAGMA foreign_keys=ON）"
    );
}
