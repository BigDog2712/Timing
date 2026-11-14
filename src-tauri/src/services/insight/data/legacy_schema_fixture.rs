//! 测试专用：把一条已经跑到 head 28 的 `patina.db` **物理回退**成迁移 28 之前的样子。
//!
//! ## 为什么需要它
//!
//! 有几条既有用例（快照 merge / widget 退休 / 旧库升级）用「篡改 `_sqlx_migrations`
//! 账本」来伪造旧库：删掉几条 version 再跑启动流程，让 Migrator 把缺的那些重跑一遍。
//! 迁移 28 之前这招够用，因为那些迁移全都可重跑。
//!
//! 迁移 28 不行：它有 8 条 `ALTER TABLE … ADD COLUMN`，而 SQLite 没有
//! `ADD COLUMN IF NOT EXISTS`（本仓 K-13）。只要物理列还在，重跑就撞
//! `duplicate column name`，用例直接在"造旧库"这一步炸掉。
//!
//! 所以这里把 28 加的东西**真的拆回去**：触发器 → 索引 → 列 → 新表。拆完的库与
//! 「只跑到 27 的库」在结构上等价，用例原来想验的东西（旧快照能被 merge/restore、
//! 退休动作不被跳过）就仍然验得到。
//!
//! ⚠️ 只给测试用，不挂任何生产路径。生产库里「账本比物理结构旧」的情况由
//! `schema_core` 的迁移流程负责，那里不允许伪造账本。

use sqlx::{Executor, SqlitePool};

/// 28 加进 `sessions` 的列（`app_key` 是生成列，同样要拆）。
const SESSIONS_COLUMNS: &[&str] = &[
    "app_key",
    "synced_seq",
    "updated_at_ms",
    "uid",
    "device_id",
];

/// 把库回退到迁移 27 结束时的样子，并把账本截到 27。
pub(crate) async fn rewind_to_pre_device_dimension(pool: &SqlitePool) -> Result<(), String> {
    let statements = [
        "DELETE FROM _sqlx_migrations WHERE version >= 28".to_string(),
        "DROP TRIGGER IF EXISTS trg_sessions_uid".to_string(),
        "DROP INDEX IF EXISTS uq_sessions_open_per_device".to_string(),
        "DROP INDEX IF EXISTS uq_sessions_uid".to_string(),
        "DROP INDEX IF EXISTS idx_sessions_device_date".to_string(),
        "DROP INDEX IF EXISTS idx_sessions_pending".to_string(),
        "DROP TABLE IF EXISTS devices".to_string(),
        "DROP TABLE IF EXISTS activity_daily_totals".to_string(),
        // `activity_hourly_effective` **不**删：迁移 28 的 ⑥ 段会 DROP TABLE 重建它，
        // 而删掉会让 `has_activity_read_models_schema` 变假 —— 那正是历史归一化里
        // `expected.truncate(IMPORT_DATA_ISOLATION_VERSION)` 的判据，会把账本截得太短。
    ];
    let mut all: Vec<String> = statements.to_vec();
    for column in SESSIONS_COLUMNS {
        all.push(format!("ALTER TABLE sessions DROP COLUMN {column}"));
    }
    all.push("ALTER TABLE import_exact_sessions DROP COLUMN app_key".to_string());
    all.push("ALTER TABLE import_time_buckets DROP COLUMN app_key".to_string());
    // 旧的全库单活跃索引也在 28 里被摘掉了，回退时按旧形态建回来。
    all.push(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
         ON sessions((1)) WHERE end_time IS NULL"
            .to_string(),
    );
    for statement in all {
        pool.execute(statement.as_str())
            .await
            .map_err(|error| format!("failed to rewind the fixture schema: {error}"))?;
    }
    Ok(())
}
