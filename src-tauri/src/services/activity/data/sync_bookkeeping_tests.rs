//! 同步簿记（P4 · T11）活动库侧的验收用例。
//!
//! 为什么单独一个文件：`sqlite_pool_mod_tests.rs` 冻结在 992 行、`schema_contracts` 也不该
//! 再长；而这里钉的东西属于**这一版的新契约**（谁在什么时候盖戳、删行会不会留墓碑），
//! 不属于「sqlite pool 的旧行为」。业务库那一套另见 `sync_bookkeeping_business_tests.rs`。
//!
//! ⚠️ 最贵的两条：
//! 1. `touch_is_monotonic_when_the_clock_goes_backwards` —— 时钟回拨后时间戳必须仍然严格
//!    递增，否则对端 LWW 判错、**新数据被旧数据覆盖**（不是丢更新，是被旧值打死）。
//! 2. `deleting_a_session_writes_exactly_one_tombstone` + `suppressed_deletes_…` —— 墓碑缺了，
//!    删掉的行会在下一次推送里从对端复活；抑制表没清，本机真删时不记墓碑、第三台设备永不消失。

use super::sync_bookkeeping_fixture::{
    applied_head, delete_session, fresh_patina, index_exists, insert_session, self_device_id,
    set_updated_at, table_exists, tombstone_count, tombstone_deleted_at, touch_title,
    trigger_exists, uid_of, updated_at,
};
use crate::services::activity::data::schema_registry;
use crate::services::activity::data::sqlite_pool::{
    open_single_connection_sqlite_pool, prepare_pool_schema,
};
use crate::services::activity::data::sync::INCLUDE_TIME_RECORDS;
use sqlx::{Row, SqlitePool};

#[test]
fn registered_head_is_the_sync_bookkeeping_version() {
    let head = schema_registry::tracker_migrations()
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default();
    assert_eq!(head, schema_registry::head_version());
    assert_eq!(head, 30, "这一轮把 head 抬到了事项归属（30）");
}

/// 本轮**不同步** `time_records`（`items` 未过桥 ⇒ `itemId` 跨设备悬空）。
///
/// 钉成用例而不是只写在注释里：打开这个开关是一次产品决策，改的人必须看到这条红。
#[test]
fn time_records_are_not_shipped_this_round() {
    const { assert!(!INCLUDE_TIME_RECORDS) };
}

/// 空库走到 head 29：四张同步表 + 墓碑 + 抑制表 + 三个触发器 + 扫描索引全在。
#[test]
fn fresh_database_reaches_sync_bookkeeping_head() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;

        for table in [
            "sync_peer",
            "sync_pull_state",
            "sync_push_state",
            "sync_channel",
            "sync_tombstone",
            "sync_suppress",
        ] {
            assert!(table_exists(&pool, table).await, "missing table {table}");
        }
        for trigger in [
            "trg_sessions_touch_insert",
            "trg_sessions_touch_update",
            "trg_sessions_tombstone",
        ] {
            assert!(trigger_exists(&pool, trigger).await, "missing trigger {trigger}");
        }
        assert!(index_exists(&pool, "idx_sessions_updated").await);
        assert_eq!(applied_head(&pool).await, 30);
    });
}

/// 新插入的行由触发器盖戳（`updated_at_ms > 0`），改写内容后戳跟着走。
#[test]
fn inserting_and_updating_a_session_stamps_updated_at_ms() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let id = insert_session(&pool, &self_device_id(&pool).await, 1_000).await;

        let stamped = updated_at(&pool, id).await;
        assert!(stamped > 0, "insert trigger must stamp updated_at_ms, got {stamped}");

        set_updated_at(&pool, id, 0).await;
        touch_title(&pool, id, "changed").await;
        assert!(updated_at(&pool, id).await > 0, "update trigger must re-stamp");
    });
}

/// 时钟回拨后时间戳**仍然严格递增**（`MAX(now, OLD+1)`）。
///
/// 造法：把 OLD 手动写到未来 1 小时，再改内容。若实现写成纯 `now`，新值会**小于** OLD
/// ——那正是「用户改过系统时间后，新数据被旧数据覆盖」的形状。
/// 同时顺带钉住「不递归」：一次 UPDATE 只加 1，若触发器自指会加成 2 以上。
#[test]
fn touch_is_monotonic_when_the_clock_goes_backwards() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let id = insert_session(&pool, &self_device_id(&pool).await, 1_000).await;

        let future = 4_102_444_800_000; // 2100-01-01T00:00:00Z，明显在"现在"之后
        set_updated_at(&pool, id, future).await;
        touch_title(&pool, id, "after-clock-rollback").await;

        assert_eq!(
            updated_at(&pool, id).await,
            future + 1,
            "timestamp must grow by exactly 1 (OLD+1 wins over a rolled-back clock, no self-recursion)"
        );
    });
}

/// 硬删一行 → 墓碑 +1，`kind='s'`，`device_id` 保留原值（不是本机、不是空）。
#[test]
fn deleting_a_session_writes_exactly_one_tombstone() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let device_id = "ffffffffffff";
        let id = insert_session(&pool, device_id, 1_000).await;
        let uid = uid_of(&pool, id).await;

        delete_session(&pool, id).await;
        assert_eq!(tombstone_count(&pool).await, 1, "exactly one tombstone");

        let row = sqlx::query("SELECT kind, device_id FROM sync_tombstone WHERE uid = ?1")
            .bind(&uid)
            .fetch_one(&pool)
            .await
            .unwrap();
        assert_eq!(row.get::<String, _>("kind"), "s");
        assert_eq!(row.get::<String, _>("device_id"), device_id);
    });
}

/// 同一个 uid 再删一次：`ON CONFLICT` 只更新时间戳，**不新增行**。
#[test]
fn re_deleting_the_same_uid_updates_the_existing_tombstone() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let device_id = self_device_id(&pool).await;

        let first = insert_session(&pool, &device_id, 1_000).await;
        let uid = uid_of(&pool, first).await;
        delete_session(&pool, first).await;
        let first_deleted_at = tombstone_deleted_at(&pool, &uid).await;

        // 用同一个 uid 重新落一行（模拟「恢复了备份又删一次」），再删。
        sqlx::query(
            "INSERT INTO sessions(app_name, exe_name, window_title, start_time, end_time,
                                  duration, device_id, uid)
             VALUES ('App', 'app.exe', '', 2000, 2500, 500, ?1, ?2)",
        )
        .bind(&device_id)
        .bind(&uid)
        .execute(&pool)
        .await
        .unwrap();
        let again = sqlx::query_scalar::<_, i64>("SELECT id FROM sessions WHERE uid = ?1")
            .bind(&uid)
            .fetch_one(&pool)
            .await
            .unwrap();
        delete_session(&pool, again).await;

        assert_eq!(tombstone_count(&pool).await, 1, "conflict must not add a row");
        assert!(
            tombstone_deleted_at(&pool, &uid).await >= first_deleted_at,
            "deleted_at_ms must not go backwards"
        );
    });
}

/// 抑制表里有这条 uid 时不记墓碑（应用对端墓碑的路径），清掉之后本地真删又会记。
///
/// 漏了抑制 ⇒ 每跳都刷新时间戳 ⇒ 分片永不稳定；抑制表忘了清 ⇒ 本机日后真删同一 uid
/// 时不记墓碑 ⇒ 第三台设备上那条永不消失。
#[test]
fn suppressed_deletes_do_not_write_tombstones() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let device_id = self_device_id(&pool).await;

        let suppressed = insert_session(&pool, &device_id, 1_000).await;
        let suppressed_uid = uid_of(&pool, suppressed).await;
        sqlx::query("INSERT INTO sync_suppress(uid) VALUES (?1)")
            .bind(&suppressed_uid)
            .execute(&pool)
            .await
            .unwrap();
        delete_session(&pool, suppressed).await;
        assert_eq!(tombstone_count(&pool).await, 0, "suppressed delete must stay silent");

        sqlx::query("DELETE FROM sync_suppress WHERE uid = ?1")
            .bind(&suppressed_uid)
            .execute(&pool)
            .await
            .unwrap();
        let local = insert_session(&pool, &device_id, 3_000).await;
        delete_session(&pool, local).await;
        assert_eq!(tombstone_count(&pool).await, 1, "local delete must record again");
    });
}

/// 删行不能把读模型的脏区间触发器弄丢：删完必须有一段落进 `activity_summary_dirty_ranges`。
///
/// SQLite 允许同一个事件挂多个触发器；「新增一个就把旧的顶掉」是这类改动的常见事故
/// （旧的被 DROP 掉、读模型不再重算，界面上表现为「删了记录但数字不变」）。
#[test]
fn deleting_a_session_still_marks_the_read_model_dirty() {
    tauri::async_runtime::block_on(async {
        let pool = fresh_patina().await;
        let id = insert_session(&pool, &self_device_id(&pool).await, 1_000).await;

        sqlx::query("DELETE FROM activity_summary_dirty_ranges")
            .execute(&pool)
            .await
            .unwrap();
        delete_session(&pool, id).await;

        let dirty: i64 = sqlx::query_scalar("SELECT COUNT(*) FROM activity_summary_dirty_ranges")
            .fetch_one(&pool)
            .await
            .unwrap();
        assert!(dirty >= 1, "read model must stay dirty after a delete, got {dirty}");
    });
}

/// 同一份 schema 在**文件库**上也建得出来（内存库与文件库的 PRAGMA 行为偶有差异，
/// 而线上全是文件库）。
#[test]
fn file_backed_pool_reaches_the_same_head() {
    tauri::async_runtime::block_on(async {
        let dir = std::env::temp_dir().join(format!(
            "timing-sync-bookkeeping-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let db_path = dir.join("patina.db");
        let pool = open_single_connection_sqlite_pool(&db_path, true)
            .await
            .unwrap();
        prepare_pool_schema(&pool, &db_path).await.unwrap();
        assert_eq!(applied_head(&pool).await, 30);
        assert_eq!(sync_tombstone_rows(&pool).await, 0);
        pool.close().await;
        let _ = std::fs::remove_dir_all(&dir);
    });
}

async fn sync_tombstone_rows(pool: &SqlitePool) -> i64 {
    sqlx::query_scalar("SELECT COUNT(*) FROM sync_tombstone")
        .fetch_one(pool)
        .await
        .unwrap()
}
