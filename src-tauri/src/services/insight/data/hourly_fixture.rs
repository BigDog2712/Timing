//! 小时投影用例的公共建库夹具。
//!
//! ## 为什么单独一个文件
//!
//! 迁移 28 之后，夹具必须建出**带设备维度**的库：`sessions.device_id` 列、
//! `devices` 表、按设备拆开的部分唯一索引、主键含 `device_id` 的小时投影。
//! 投影写侧要从 `devices.is_self = 1` 取归属设备，少一样就跑不起来。
//!
//! 而 `hourly_contract_tests.rs` 正好压在 `check:size` 的冻结线上（865 行），
//! 加不下这几行；夹具本身又和"断言了什么"无关，所以整块搬到这里，
//! `contract_tests` 用一行 `pub(super) use` 把它接回去（`benchmark` 因此不用改）。
//!
//! ## 夹具里 `sessions.device_id` 仍是 `''`（迁移期哨兵）
//!
//! 用例直接 `INSERT INTO sessions(...)`，不写 `device_id`，落的是迁移 28 的
//! `DEFAULT ''`。这正好是真实启动流程里"迁移 28 跑完、`adopt_local_rows` 还没跑"
//! 的那一瞬间的状态：投影已经能归属设备，事实行还挂着哨兵。P1 的读路径一个字节
//! 都不看 `device_id`（设计 §3.5），所以这不影响任何断言。

use crate::services::insight::data::repositories::anonymous_activity::SCHEMA_SQL as ANONYMOUS_SCHEMA_SQL;
use crate::services::insight::data::schema::{
    ACTIVITY_READ_MODELS_SCHEMA_SQL, CURRENT_BASELINE_SCHEMA_SQL, IMPORT_DATA_ISOLATION_SCHEMA_SQL,
    IMPORT_DATA_SCHEMA_SQL, SESSION_RANGE_INDEX_SCHEMA_SQL,
};
use crate::services::insight::data::schema_registry::DEVICE_DIMENSION_SQL;
use sqlx::{Executor, SqlitePool};

/// 夹具设备的 `install_id`。必须是 12 位小写 hex（与真实身份同形），
/// 否则 `devices.install_id` 的 CHECK 与 `schema_core` 的身份校验会在别处失败。
const FIXTURE_INSTALL_ID: &str = "00000000f1c0";

/// 建一个走到迁移 28 head 的 `:memory:` 库。
pub(crate) async fn setup_pool() -> SqlitePool {
    let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
    for schema in [
        CURRENT_BASELINE_SCHEMA_SQL,
        IMPORT_DATA_SCHEMA_SQL,
        IMPORT_DATA_ISOLATION_SCHEMA_SQL,
        ACTIVITY_READ_MODELS_SCHEMA_SQL,
        ANONYMOUS_SCHEMA_SQL,
        // `idx_sessions_end_start`：迁移 28 之后活跃会话探针钉的就是它
        // （`facts::ACTIVE_SESSION_START_SQL`），少了这张索引探针直接报 no such index。
        SESSION_RANGE_INDEX_SCHEMA_SQL,
        DEVICE_DIMENSION_SQL,
    ] {
        pool.execute(schema).await.unwrap();
    }
    // 归属设备：投影写侧从这一行取 `install_id`（真实库里由
    // `services::device::ensure_self` 在启动时装上）。
    sqlx::query(
        "INSERT INTO devices(install_id, label, platform, color, is_self, first_seen_ms, last_seen_ms)
         VALUES (?1, '', 'windows', '', 1, 0, 0)",
    )
    .bind(FIXTURE_INSTALL_ID)
    .execute(&pool)
    .await
    .unwrap();
    pool
}

/// 小时投影表的**当前形态**（主键含 `device_id`）。
///
/// ⚠️ 与 `sql/0028_device_dimension.sql` 的 ⑥ 段同义。之所以在这里再落一份：
/// 有一条用例专门验证「投影表被删掉 → 读走事实回退 → 修复后走投影」，而修复动作
/// 只能在这里做（迁移 28 的正文不能整体重跑，前面几条 `ADD COLUMN` 会撞
/// `duplicate column name`）。`device_schema_upgrade_tests` 里有一条用例把这里的表结构
/// 与迁移 28 建出来的表结构逐字比对，漂移会立刻红。
pub(crate) const PROJECTION_TABLE_SQL: &str = "
CREATE TABLE activity_hourly_effective (
  bucket_start_ms  INTEGER NOT NULL,
  bucket_end_ms    INTEGER NOT NULL,
  device_id        TEXT    NOT NULL CHECK(TRIM(device_id) <> ''),
  app_key          TEXT    NOT NULL CHECK(TRIM(app_key) <> ''),
  raw_exe_name     TEXT    NOT NULL CHECK(TRIM(raw_exe_name) <> ''),
  display_app_name TEXT    NOT NULL DEFAULT '',
  origin           TEXT    NOT NULL CHECK(origin IN ('native','import_exact','import_bucket')),
  source_id        TEXT    NOT NULL,
  effective_duration_ms INTEGER NOT NULL CHECK(effective_duration_ms > 0),
  computed_revision INTEGER NOT NULL CHECK(computed_revision >= 0),
  updated_at_ms    INTEGER NOT NULL DEFAULT 0 CHECK(updated_at_ms >= 0),
  PRIMARY KEY(bucket_start_ms, device_id, app_key, origin, source_id),
  CHECK(bucket_end_ms > bucket_start_ms),
  CHECK(effective_duration_ms <= bucket_end_ms - bucket_start_ms)
);

CREATE INDEX IF NOT EXISTS idx_activity_hourly_range
  ON activity_hourly_effective(bucket_start_ms, bucket_end_ms);
CREATE INDEX IF NOT EXISTS idx_activity_hourly_device_range
  ON activity_hourly_effective(device_id, bucket_start_ms);
CREATE INDEX IF NOT EXISTS idx_activity_hourly_app_range
  ON activity_hourly_effective(app_key, bucket_start_ms, effective_duration_ms);
";

/// 删掉并重建小时投影表（模拟「投影被删 → 修复」的用例用）。
pub(crate) async fn recreate_projection(pool: &SqlitePool) {
    pool.execute("DROP TABLE IF EXISTS activity_hourly_effective")
        .await
        .unwrap();
    pool.execute(PROJECTION_TABLE_SQL).await.unwrap();
}

/// 插一条**已关闭**的原生会话（`app_name`/`exe_name` 固定，便于按应用断言）。
///
/// 不写 `device_id`：落的是迁移 28 的 `DEFAULT ''` 哨兵（见文件头）。
pub(crate) async fn insert_native(pool: &SqlitePool, start: i64, end: Option<i64>) {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, end_time, duration)
         VALUES ('Editor', 'editor.exe', ?, ?, ?)",
    )
    .bind(start)
    .bind(end)
    .bind(end.map(|end| end - start))
    .execute(pool)
    .await
    .unwrap();
}

/// 插一条**进行中**会话（`end_time IS NULL`），归属设备显式给定。
pub(crate) async fn insert_open_session(pool: &SqlitePool, device_id: &str, start_time: i64) {
    sqlx::query(
        "INSERT INTO sessions(app_name, exe_name, start_time, device_id)
         VALUES ('Editor', 'editor.exe', ?, ?)",
    )
    .bind(start_time)
    .bind(device_id)
    .execute(pool)
    .await
    .unwrap();
}

/// 反复驱动后台维护直到它说「没活了」。
///
/// 上限不是为了防御死循环，而是让「回填没收敛」这件事以一条明确的断言失败出现，
/// 而不是把用例挂死。
pub(crate) async fn drain(pool: &SqlitePool) {
    for _ in 0..1000 {
        if !super::activity_read_model::maintain_once(pool).await.unwrap() {
            return;
        }
    }
    panic!("hourly maintenance did not converge");
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 钉住「夹具的那份投影 DDL」和「迁移 28 建出来的表」逐字一致。
    ///
    /// 这条存在的唯一理由是 `PROJECTION_TABLE_SQL` 是迁移正文的一份拷贝：一旦有人
    /// 只改了 `sql/0028_device_dimension.sql` 的 ⑥ 段（或反过来），修复用例会在
    /// 「读路径应该回到投影」那一步变红，而那张表看起来一切正常。
    #[test]
    fn fixture_projection_table_matches_migration_28() {
        tauri::async_runtime::block_on(async {
            let migrated = setup_pool().await;
            let migrated_sql = table_sql(&migrated).await;
            migrated.close().await;

            let recreated = SqlitePool::connect("sqlite::memory:").await.unwrap();
            recreated.execute(PROJECTION_TABLE_SQL).await.unwrap();
            assert_eq!(table_sql(&recreated).await, migrated_sql);
            recreated.close().await;
        });
    }

    async fn table_sql(pool: &SqlitePool) -> String {
        sqlx::query_scalar(
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'activity_hourly_effective'",
        )
        .fetch_one(pool)
        .await
        .unwrap()
    }
}
