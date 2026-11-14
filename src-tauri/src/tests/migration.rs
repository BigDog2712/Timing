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
    // schema 版本登记：全部迁移跑完推进到 8（K-7 / Spec §6 迁移铁律；v3 = 便利贴置顶列，ADR-019；
    // v4 = 待办提醒链路的 remind_stage / auto_start，ADR-030；v5 = 待办绑定事项 item_id，ADR-042；
    // v6 = 云端待传队列 md_cloud_pending，ADR-061；v7 = 该队列按通路隔离；v8 = app_usage 应用使用统计）
    assert_eq!(
        scalar_opt_str(
            &pool,
            "SELECT value FROM settings WHERE key = 'schema.version'"
        )
        .await
        .as_deref(),
        Some("10")
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
        "uq_records_open_per_device",
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
    // uq_records_open_per_device 必须是「仅 active」的部分唯一索引，
    // 且旧的全库单活跃索引 `uq_records_open` 必须已被 0009 的抵消段摘掉
    let sql = scalar_opt_str(
        &pool,
        "SELECT sql FROM sqlite_master WHERE name = 'uq_records_open_per_device'",
    )
    .await
    .expect("应有 uq_records_open_per_device 定义");
    let normalized = sql.to_lowercase().replace(['"', ' '], "");
    assert!(
        normalized.contains("wherestatus='active'"),
        "uq_records_open_per_device 应为 WHERE status='active' 的部分索引，实际：{sql}"
    );
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM sqlite_master WHERE name = 'uq_records_open'"
        )
        .await,
        0,
        "0002 每次启动都会建回 uq_records_open，0009 的抵消段必须摘掉它"
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
    // 设备维度（0009）的**第二次**启动：`0002_v020.sql` 会在每次启动时把「全库单活跃」
    // 的旧索引 `uq_records_open` 建回来，所以抵消段必须无条件跑（它没有版本门）。
    // 把 `migrate()` 里那段 `run_raw(_guard)` 删掉，这两条断言立刻变红。
    assert_eq!(
        scalar_i64(
            &p2,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' AND name='uq_records_open'"
        )
        .await,
        0,
        "第二次启动后旧索引必须仍被 0009 抵消段摘掉"
    );
    assert_eq!(
        scalar_i64(
            &p2,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
             AND name='uq_records_open_per_device'"
        )
        .await,
        1
    );
}

async fn insert_active(
    pool: &SqlitePool,
    item_id: i64,
    device_id: &str,
) -> Result<sqlx::sqlite::SqliteQueryResult, sqlx::Error> {
    sqlx::query(
        "INSERT INTO time_records \
         (item_id, status, started_at, ended_at, accumulated_sec, running_since, created_at, \
          updated_at, device_id) \
         VALUES (?, 'active', 1000, NULL, 0, 1000, 1000, 1000, ?)",
    )
    .bind(item_id)
    .bind(device_id)
    .execute(pool)
    .await
}

/// 0009 之后「进行中」是**每设备**一条，不再是全库一条。
///
/// 旧版本这里只断「第二条 active 失败」——而两条都用 `device_id = ''`，
/// 命中的其实是 `uq_records_open_per_device` 上「同一个 '' 设备」那一支，
/// 于是用例在「迁移 28 根本没生效」时也会绿。现在拆成两条断言：
/// 两台设备各一条**必须都成功**，同一台设备的第二条**必须失败**。
#[tokio::test]
async fn unique_active_session_is_per_device_not_global() {
    let pool = fresh_pool("mig-active-unique").await;
    insert_active(&pool, 1, "aaaaaaaaaaaa")
        .await
        .expect("device a 的 active 应成功");
    insert_active(&pool, 1, "bbbbbbbbbbbb")
        .await
        .expect("device b 的 active 应成功（全库唯一会在这里红）");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM time_records WHERE status = 'active'"
        )
        .await,
        2,
        "两台设备的进行中记录都必须留下"
    );
    let duplicate = insert_active(&pool, 1, "aaaaaaaaaaaa").await;
    // SQLite 的唯一约束报错点名**列**（`time_records.device_id`），不是索引名；
    // 索引按名单独断下面那一行。
    let message = duplicate
        .expect_err("同设备第二条 active 应被拒绝")
        .to_string();
    assert!(message.contains("time_records.device_id"), "{message}");
    assert_eq!(
        scalar_i64(
            &pool,
            "SELECT COUNT(*) FROM sqlite_master WHERE type='index' \
             AND name='uq_records_open_per_device'"
        )
        .await,
        1
    );
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
