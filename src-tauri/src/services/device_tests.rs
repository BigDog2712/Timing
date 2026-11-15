//! `services::device` 的判据：启动接线必须把哨兵行认领到本机，并让**库**把 uid 发出来。
//!
//! ## 为什么单独一个文件
//!
//! `device.rs` 本来就贴着单文件 300 行门禁（`npm run check:size` 的棘轮），而这次要加的
//! 是「四张表全覆盖」那条表驱动用例 —— 放进正文就超限。拆法与
//! `repositories/timer_ops_tests.rs` 同一套：正文只留接线，判据整段搬到这里。
//!
//! ## 三条用例挡的是同一件事的三个面
//!
//! 1. 缓存要被填上 —— `identity::install_id()` 是计时事件流唯一的取值来源，填不上就是
//!    「所有事件都没有 device_id → uid 恒 NULL → 永不同步」，且零报错；
//! 2. `items` 的历史行要被认领 —— 真机上那批行 `uid` 全 NULL、`device_id` 全空串；
//! 3. 四张带 uid 语义的表**一张都不能漏** —— 漏登记一张不报错，只是那批行永远不导出。

use sqlx::SqlitePool;

use super::device::startup_business_identity;

/// 全新业务库（迁移到 head，含 `trg_*_uid` 触发器，但**不**跑身份认领）。
async fn fresh_business_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    crate::infra::migrate::migrate(&pool).await.unwrap();
    pool
}

/// `device_id` 走默认值 `''`、`uid` 保持 NULL 的行 —— 迁移期哨兵，认领要处理的就是它。
///
/// 列只给 NOT NULL 的最小集，其余走建表默认值：多写一列就等于在用例里复制了一份建表语句，
/// 迁移再加列时这里得跟着改，而它本来只是想造一行「没属主的数据」。
const SENTINEL_INSERTS: &[&str] = &[
    "INSERT INTO items (name, status, is_system, sort_order, created_at, updated_at) \
     VALUES ('哨兵事项', 'active', 0, 9, 1000, 1000)",
    "INSERT INTO time_records (item_id, status, started_at, ended_at, created_at, updated_at) \
     VALUES (1, 'saved', 1000, 2000, 1000, 1000)",
    "INSERT INTO item_app (item_id, app_key, created_at, updated_at) \
     VALUES (1, 'sentinel.exe', 1000, 1000)",
    "INSERT INTO timer_ops (session_uid, item_uid, kind, at_ms, day_key, created_at) \
     VALUES ('t:seed:1', 'i:seed:1', 'start', 1000, '2026-11-14', 1000)",
];

/// 业务库的认领：哨兵 `''` → 本机，`uid` 由 `t:` 前缀发出，重复跑不改值。
#[test]
fn business_identity_adopts_sentinel_rows_and_mints_time_record_uids() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO time_records (item_id, status, started_at, ended_at, created_at, updated_at)
             VALUES (1, 'saved', 1000, 2000, 1000, 1000)",
        )
        .execute(&pool)
        .await
        .unwrap();

        let install_id = startup_business_identity(&pool).await.unwrap();
        let (device_id, uid): (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM time_records")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(device_id, install_id);
        assert_eq!(uid.as_deref(), Some(format!("t:{install_id}:1").as_str()));

        // 幂等：第二次启动不改任何值，也不再产生新的 uid。
        startup_business_identity(&pool).await.unwrap();
        let again: (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM time_records")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!((again.0, again.1), (device_id, uid));
    });
}

/// `items` 的历史行同样要被认领：`device_id` 补成本机，`uid` 发成 `i:<install>:<id>`。
///
/// 这条是「新建事项永不同步」的另一半判据：写入点漏写 `device_id` 造出来的那批行
/// （真机 22 行），只能靠启动认领补回来。补完再跑一次启动，值不许变 —— 否则每次开机
/// 都会把这些行的 `updated_at_ms` 推到现在，同步时全库变脏。
#[test]
fn business_identity_adopts_item_sentinel_rows_idempotently() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_business_pool().await;
        sqlx::query(
            "INSERT INTO items (name, status, is_system, sort_order, created_at, updated_at)
             VALUES ('历史事项', 'active', 0, 7, 1000, 1000)",
        )
        .execute(&pool)
        .await
        .unwrap();
        /* 前置：这行确实是「没属主」的哨兵形状（否则下面的断言就没在测认领）。 */
        let before: (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM items WHERE name = '历史事项'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(before, (String::new(), None));

        let install_id = startup_business_identity(&pool).await.unwrap();
        let after: (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM items WHERE name = '历史事项'")
                .fetch_one(&pool)
                .await
                .unwrap();
        let id: i64 = sqlx::query_scalar("SELECT id FROM items WHERE name = '历史事项'")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(after.0, install_id, "items.device_id 该被认领到本机");
        assert_eq!(
            after.1.as_deref(),
            Some(format!("i:{install_id}:{id}").as_str()),
            "items.uid 该由 trg_items_uid 按认领后的 device_id 发出来"
        );

        // 幂等：再跑一次启动，两列逐字不变。
        startup_business_identity(&pool).await.unwrap();
        let again: (String, Option<String>) =
            sqlx::query_as("SELECT device_id, uid FROM items WHERE name = '历史事项'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(again, after, "重复认领改动了值（不再幂等）");
    });
}

/// 四张带 uid 语义的表**一张都不能漏**：一次启动后每张表的 uid 前缀各按 `BUSINESS_UID_ADOPTIONS`。
///
/// 为什么必须是表驱动：漏登记一张表**不会有任何报错**，表现只是「那批行永远没有 uid、
/// 永远不导出」。所以要逐张钉：`i:` / `t:` / `b:` / `p:` 各查一遍。
#[test]
fn business_identity_adopts_all_four_uid_tables() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_business_pool().await;
        for sql in SENTINEL_INSERTS {
            sqlx::query(sql).execute(&pool).await.unwrap();
        }

        let install_id = startup_business_identity(&pool).await.unwrap();

        for (table, prefix) in [
            ("items", "i:"),
            ("time_records", "t:"),
            ("item_app", "b:"),
            ("timer_ops", "p:"),
        ] {
            let missing: i64 =
                sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE uid IS NULL"))
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(
                missing, 0,
                "{table} 还有 uid 为空的行 —— 认领表里漏了这张表？"
            );
            let wrong_shape: i64 = sqlx::query_scalar(&format!(
                "SELECT COUNT(*) FROM {table} WHERE uid <> ?1 || ?2 || ':' || id"
            ))
            .bind(prefix)
            .bind(&install_id)
            .fetch_one(&pool)
            .await
            .unwrap();
            assert_eq!(
                wrong_shape, 0,
                "{table} 的 uid 不是 `{prefix}<install>:<id>` 的形状（前缀登记错了？）"
            );
            let device_left: i64 =
                sqlx::query_scalar(&format!("SELECT COUNT(*) FROM {table} WHERE device_id <> ?1"))
                    .bind(&install_id)
                    .fetch_one(&pool)
                    .await
                    .unwrap();
            assert_eq!(device_left, 0, "{table} 还有 device_id 不是本机的行");
        }
    });
}

/// 启动接线必须把身份登记进缓存 —— 这是计时事件流唯一的取值来源。
///
/// 没有这条断言，「缓存没填」的表现是「所有计时事件 `device_id` 为空、uid 恒 NULL、
/// 永远不同步」，而且零报错。用例必须跑在**没有别的用例填过缓存**的前提下才有意义，
/// 所以它断言的是「登记后能读到同一个值」而不是「首次调用能生成」。
#[test]
fn startup_registers_the_identity_for_the_timer_event_stream() {
    tauri::async_runtime::block_on(async {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        crate::infra::migrate::migrate(&pool).await.unwrap();
        let install_id = startup_business_identity(&pool).await.unwrap();
        assert_eq!(
            crate::services::identity::install_id(),
            Some(install_id.as_str())
        );
        assert!(crate::services::identity::is_valid(install_id.as_str()));
    });
}
