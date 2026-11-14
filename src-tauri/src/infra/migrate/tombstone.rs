//! 墓碑表类别放宽：`sync_tombstone.kind` 从 `('s','t')` 到不限。
//!
//! 单独一个文件：`migrate.rs` 压在 300 行硬限附近，而这段的推理密度与主迁移流程无关
//! ——它讲的是 SQLite 的两条 DDL 限制，不是迁移顺序。
//!
//! ## 为什么要重建表
//!
//! SQLite 改不了已有 CHECK 约束，只能 CREATE + INSERT SELECT + DROP + RENAME。
//! 为什么不用纯 SQL 一次做完：那需要「先判断当前结构再决定跑哪些语句」，纯 SQL 没有
//! 条件执行；而把 DROP 写成 `IF EXISTS` 又会在一次部分失败后丢掉全部墓碑 —— 墓碑是
//! 永久保留的数据，丢了就意味着对端永远删不掉那条已删记录。
//!
//! ## 为什么必须先删触发器
//!
//! `DROP TABLE` 时 SQLite 会重新解析引用该表的对象，悬空引用直接报
//! `error in trigger ...: no such table`（实测出来的，不是理论推测）。所以第一步是
//! DROP TRIGGER；触发器随后由 `0011_v0142_item_attribution_guard.sql` 重建
//! （那份定义与 0010 guard 里的一字不差）。
//!
//! ## 为什么不在版本门里
//!
//! 四步（删触发器 / 建新表 / 搬数据 / 换名）必须原子，而 `run_raw` 的多语句在 SQLite 上
//! 逐条自动提交。放进版本门只会把「可能部分成功」藏起来；放在这里 + 单事务 +
//! `sqlite_master` 判据，才是「跑多少次结果都一样」。

use sqlx::SqlitePool;

use crate::error::{AppError, AppResult};

/// 判据用建表 SQL 里是否含旧 CHECK，而不是「表在不在」：旧库升级前表已存在，
/// 新库在 0010 建出来的也是旧结构，两种情况都要重建且只重建一次。
pub(super) async fn widen_kinds(pool: &SqlitePool) -> AppResult<()> {
    let create_sql: Option<String> = sqlx::query_scalar(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'sync_tombstone'",
    )
    .fetch_optional(pool)
    .await
    .map_err(AppError::db)?;
    let Some(create_sql) = create_sql else {
        /* 表还没建（0001–0010 都跑完了却仍不存在）：交给 0010 guard 下次启动建。
           这里不能自己建一个结构不同的版本，否则 guard 的 `CREATE TABLE IF NOT EXISTS`
           会永久跳过它。 */
        return Ok(());
    };
    if !create_sql.contains("kind IN ('s','t')") {
        return Ok(());
    }

    let mut tx = pool.begin().await.map_err(AppError::db)?;
    /* 逐条执行而不是 `raw_sql` 多语句：多语句在事务里中途失败时，报错位置指向整段的
       开头，排查会被带到「建表」而不是真正失败的那一步。 */
    let steps = [
        "DROP TRIGGER IF EXISTS trg_time_records_tombstone",
        "CREATE TABLE sync_tombstone_v11 (
             uid           TEXT    PRIMARY KEY,
             kind          TEXT    NOT NULL,
             device_id     TEXT    NOT NULL,
             deleted_at_ms INTEGER NOT NULL
         )",
        "INSERT INTO sync_tombstone_v11(uid, kind, device_id, deleted_at_ms)
             SELECT uid, kind, device_id, deleted_at_ms FROM sync_tombstone",
        "DROP TABLE sync_tombstone",
        "ALTER TABLE sync_tombstone_v11 RENAME TO sync_tombstone",
        "CREATE INDEX IF NOT EXISTS idx_time_records_tombstone_time
             ON sync_tombstone(deleted_at_ms)",
    ];
    for step in steps {
        sqlx::query(step)
            .execute(&mut *tx)
            .await
            .map_err(AppError::db)?;
    }
    tx.commit().await.map_err(AppError::db)?;
    Ok(())
}
