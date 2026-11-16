//! 同步簿记 · 业务库（`timing.db`）侧的验收用例。
//!
//! 业务库与活动库是**两套迁移机制**（`infra/migrate.rs` 每次启动重跑 `.sql` +
//! `ensure_column`；活动库是 sqlx `Migrator`），所以两边必须各有一条用例。
//! 历史教训：只改活动库、忘了业务库，或者反过来，都不会有任何东西报错——
//! 只是那一侧的 `updated_at_ms` 永远 0，同步永远认为「没有一天是脏的」。
//!
//! 这一套的触发器、索引、回填全在 `0010_v0141_sync_bookkeeping_guard.sql`（每次启动无条件跑），
//! 加列在 `MIGRATE_COLUMNS_V10`（`ensure_column`），版本推进在一次性段里。

use super::sync_bookkeeping_fixture::{column_exists, index_exists, table_exists, trigger_exists};

/// 列、索引、三个触发器、盖戳、墓碑、版本推进。
#[test]
fn business_database_stamps_time_records_and_records_tombstones() {
    tauri::async_runtime::block_on(async {
        let pool = crate::tests::support::fresh_pool("sync-bookkeeping").await;

        assert!(column_exists(&pool, "time_records", "updated_at_ms").await);
        assert!(table_exists(&pool, "sync_tombstone").await);
        assert!(table_exists(&pool, "sync_suppress").await);
        assert!(index_exists(&pool, "idx_records_updated").await);
        for trigger in [
            "trg_time_records_touch_insert",
            "trg_time_records_touch_update",
            "trg_time_records_tombstone",
        ] {
            assert!(trigger_exists(&pool, trigger).await, "missing trigger {trigger}");
        }
        let version: String =
            sqlx::query_scalar("SELECT value FROM settings WHERE key = 'schema.version'")
                .fetch_one(&pool)
                .await
                .unwrap();
        assert_eq!(version, "13");

        // items.id = 1 是种子「未归类」（0001 的种子行），外键天然满足。
        //
        // `device_id` 必须显式给：业务库的哨兵值由 `services::device::adopt_local_rows`
        // 在**启动流程**里认领，`db::init_pool` 不做；而 `trg_time_records_uid` 有
        // `TRIM(NEW.device_id) <> ''` 守卫 —— 哨兵行连 uid 都不会有，自然也就没有墓碑。
        sqlx::query(
            "INSERT INTO time_records(item_id, status, started_at, ended_at,
                                      accumulated_sec, created_at, updated_at, device_id)
             VALUES (1, 'saved', 1000, 61000, 60, 1000, 61000, 'aaaaaaaaaaaa')",
        )
        .execute(&pool)
        .await
        .unwrap();
        let stamped: i64 = sqlx::query_scalar("SELECT updated_at_ms FROM time_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(stamped > 0, "insert trigger must stamp time_records.updated_at_ms");

        sqlx::query("DELETE FROM time_records")
            .execute(&pool)
            .await
            .unwrap();
        let kind: String = sqlx::query_scalar("SELECT kind FROM sync_tombstone")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(kind, "t");
    });
}

/// 回填幂等：第二次启动不再改写已有时间戳（否则「跑一次启动 = 全库变脏」）。
///
/// 造法：手工把某行改成固定值，再跑一遍 `migrate`（模拟第二次启动）。
/// 守卫段的回填条件是 `WHERE updated_at_ms = 0`，所以固定值必须**原样保留**。
#[test]
fn second_start_does_not_restamp_existing_rows() {
    tauri::async_runtime::block_on(async {
        let pool = crate::tests::support::fresh_pool("sync-bookkeeping-restamp").await;
        sqlx::query(
            "INSERT INTO time_records(item_id, status, started_at, ended_at,
                                      accumulated_sec, created_at, updated_at, device_id)
             VALUES (1, 'saved', 1000, 61000, 60, 1000, 61000, 'aaaaaaaaaaaa')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("UPDATE time_records SET updated_at_ms = 777")
            .execute(&pool)
            .await
            .unwrap();

        crate::infra::migrate::migrate(&pool).await.unwrap();

        let after: i64 = sqlx::query_scalar("SELECT updated_at_ms FROM time_records")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(after, 777, "guard backfill must not touch already stamped rows");
    });
}
