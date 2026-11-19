//! 迁移执行器（幂等）：`0001_init` → 补列 → `0002_v020` → 补列(v3) → `0003_v030` → 版本推进 → `0006_v0113`
//! → `0007`/`0008`/`0009`（这三条带版本门，因为各自都有"只许跑一次"的语义，见各步注释）。
//!
//! **K-13 硬约束**：SQLite 不支持 `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`，重复
//! `ADD COLUMN` 报 `duplicate column name`。故 items / time_records / notes 的加列**不能**
//! 靠纯 SQL 幂等，必须由 `ensure_column`（`PRAGMA table_info` 守卫）执行。
//!
//! **顺序是硬约束**：
//!   1. 先补 v2 列，再执行 `0002_v020.sql` —— 后者建的 `idx_items_remind` 依赖
//!      `items.remind_at`，旧库若先建索引会报 `no such column`（架构 §4.5）；
//!   2. 先执行 `0002_v020.sql` 建 `notes` 表，再补 `notes.is_pinned` —— 反过来
//!      `ALTER TABLE notes` 在 v1 库上会报 `no such table`。

use sqlx::{Row, SqlitePool};

mod columns;
mod outbox;
mod tombstone;

use crate::error::{AppError, AppResult};
use columns::{
    MIGRATE_COLUMNS, MIGRATE_COLUMNS_V10, MIGRATE_COLUMNS_V11, MIGRATE_COLUMNS_V17,
    MIGRATE_COLUMNS_V3, MIGRATE_COLUMNS_V4, MIGRATE_COLUMNS_V5, MIGRATE_COLUMNS_V9,
};

/// 执行全部迁移（幂等）。由 `infra::db::init_pool` 调用。
pub async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    // 旧迁移会重建全局唯一索引并回写版本号，不能在新版本库上重放。
    if schema_version(pool).await? < 1 {
        run_raw(pool, include_str!("../migrations/0001_init.sql")).await?;
    }
    // ② 补 v2 列（必须早于建索引，K-13）
    for (table, column, def) in MIGRATE_COLUMNS {
        ensure_column(pool, table, column, def).await?;
    }
    if schema_version(pool).await? < 2 {
        run_raw(pool, include_str!("../migrations/0002_v020.sql")).await?;
    }
    // ④ 补 v3 列（必须在 notes 建好之后）
    for (table, column, def) in MIGRATE_COLUMNS_V3 {
        ensure_column(pool, table, column, def).await?;
    }
    if schema_version(pool).await? < 3 {
        run_raw(pool, include_str!("../migrations/0003_v030.sql")).await?;
    }
    // ⑥ 补 v4 列（待办提醒链路）
    for (table, column, def) in MIGRATE_COLUMNS_V4 {
        ensure_column(pool, table, column, def).await?;
    }
    if schema_version(pool).await? < 4 {
        run_raw(pool, include_str!("../migrations/0004_v0312.sql")).await?;
    }
    // ⑧ 补 v5 列（待办绑定事项；必须在 todos 表建好之后）
    for (table, column, def) in MIGRATE_COLUMNS_V5 {
        ensure_column(pool, table, column, def).await?;
    }
    if schema_version(pool).await? < 5 {
        run_raw(pool, include_str!("../migrations/0005_v0113.sql")).await?;
    }
    if schema_version(pool).await? < 6 {
        run_raw(pool, include_str!("../migrations/0006_v0113.sql")).await?;
    }
    // ⑪ v7（V0.11.26）：`md_cloud_pending` 按通路隔离（加 `channel` 列、改主键）。
    //
    // 0007 是**重建表**（CREATE + INSERT SELECT + DROP + RENAME），不像前面的迁移
    // 靠 IF NOT EXISTS 幂等：runner 每次启动都重跑全部迁移，第二次撞到主键就会
    // 让启动失败。所以这一步**必须**由版本门只放行一次——`schema.version` 在
    // 0006 之后是 6，0007 执行完自己推进到 7，此后永远跳过。
    if schema_version(pool).await? < 7 {
        run_raw(pool, include_str!("../migrations/0007_v01127.sql")).await?;
    }
    // ⑫ v8（0.13.0）：新增 `app_usage`（安卓应用使用统计）。
    //
    // 本文件全是 `CREATE TABLE IF NOT EXISTS`，天然幂等，不需要版本门；但仍要显式执行一次，
    // 且**必须**在建表后推进 `schema.version`，否则下次启动的 `< 8` 判断永远为真。
    // 老库升级的判据（任务书 U6）：五张老表行数与升级前逐表相等 —— 本文件不碰任何老表。
    if schema_version(pool).await? < 8 {
        run_raw(pool, include_str!("../migrations/0008_v01300.sql")).await?;
    }
    // 设备维度先补列和索引，再推进版本。
    for (table, column, def) in MIGRATE_COLUMNS_V9 {
        ensure_column(pool, table, column, def).await?;
    }
    run_raw(
        pool,
        include_str!("../migrations/0009_v0140_device_dimension_guard.sql"),
    )
    .await?;
    if schema_version(pool).await? < 9 {
        run_raw(
            pool,
            include_str!("../migrations/0009_v0140_device_dimension.sql"),
        )
        .await?;
    }
    // ⑭ v10（0.12.2）：同步簿记。
    //
    // 结构与 0009 完全同型，理由也同型：补列（幂等守卫）→ 幂等段每次启动跑 →
    // 版本推进关在版本门里（否则会把更高的版本号改回 10）。
    for (table, column, def) in MIGRATE_COLUMNS_V10 {
        ensure_column(pool, table, column, def).await?;
    }
    run_raw(
        pool,
        include_str!("../migrations/0010_v0141_sync_bookkeeping_guard.sql"),
    )
    .await?;
    if schema_version(pool).await? < 10 {
        run_raw(
            pool,
            include_str!("../migrations/0010_v0141_sync_bookkeeping.sql"),
        )
        .await?;
    }
    // ⑮ v11（0.13.x）：事项归属（树 + 分类 + 绑定 + 计时事件）。
    //
    // 四步，顺序不可换：
    //   ① 补列 —— items 的新列由 PRAGMA 守卫，每次启动都跑；
    //   ② 放宽墓碑类别 —— 必须在 ③ 之前：guard 里的 `i`/`b`/`p` 墓碑会撞上旧
    //      `CHECK (kind IN ('s','t'))`，而那一刻的报错会指向「插入被约束拒绝」，
    //      排查方向完全错误；
    //   ③ 幂等段 —— 索引 / 新表 / 触发器，每次启动无条件跑；
    //   ④ 版本推进 —— 关在版本门里，否则会把更高的版本号改回 11。
    for (table, column, def) in MIGRATE_COLUMNS_V11 {
        ensure_column(pool, table, column, def).await?;
    }
    tombstone::widen_kinds(pool).await?;
    run_raw(
        pool,
        include_str!("../migrations/0011_v0142_item_attribution_guard.sql"),
    )
    .await?;
    if schema_version(pool).await? < 11 {
        run_raw(
            pool,
            include_str!("../migrations/0011_v0142_item_attribution.sql"),
        )
        .await?;
    }
    // ⑯ v12（0.12.5）：应用使用的**时段明细** `app_usage_span`。
    //
    // 结构与 0009–0011 同型：幂等段每次启动跑（建表 `IF NOT EXISTS`），版本推进关在
    // 版本门里。本文件不碰任何老表 —— 老库升级后五张老表行数逐表相等。
    run_raw(
        pool,
        include_str!("../migrations/0012_v01250_usage_span_guard.sql"),
    )
    .await?;
    if schema_version(pool).await? < 12 {
        run_raw(
            pool,
            include_str!("../migrations/0012_v01250_usage_span.sql"),
        )
        .await?;
    }
    /* 0.12.8：配对口径改了（同包内换 Activity 不再算离开），旧口径写下的碎段必须清掉，
    否则新旧两批段并存 —— 详见 0013 的注释。没有 guard 段：本迁移不建任何对象。 */
    if schema_version(pool).await? < 13 {
        run_raw(
            pool,
            include_str!("../migrations/0013_v01280_usage_span_purge.sql"),
        )
        .await?;
    }
    /* 0.14.0（同步重构 T01）：同步事件流基础设施（游标 `sync_event_cursor` + md 决策审计
    `md_decision_audit`）。纯新表、幂等段不需 guard，版本推进照样关门里（与 0008 同型）。
    编号是 0014 不是 0012 的原因（撞版本号会让表在存量库上永不创建）见 SQL 文件头。 */
    if schema_version(pool).await? < 14 {
        run_raw(
            pool,
            include_str!("../migrations/0014_v0150_sync_stream.sql"),
        )
        .await?;
    }
    outbox::run(pool).await?;
    // ⑰ v17（0.12.3）：事项多标签。补列必须在触发器之前（触发器写 tags 列，但建触发器
    // 本身不引用列）；版本门只包 SQL，`ensure_column` 照例每次启动跑（K-13）。
    for (table, column, def) in MIGRATE_COLUMNS_V17 {
        ensure_column(pool, table, column, def).await?;
    }
    if schema_version(pool).await? < 17 {
        run_raw(
            pool,
            include_str!("../migrations/0017_v01231_item_tags.sql"),
        )
        .await?;
    }
    Ok(())
}

async fn schema_version(pool: &SqlitePool) -> AppResult<i64> {
    let exists: bool = sqlx::query_scalar(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings')",
    )
    .fetch_one(pool)
    .await
    .map_err(AppError::db)?;
    if !exists {
        return Ok(0);
    }
    let value: Option<String> =
        sqlx::query_scalar("SELECT value FROM settings WHERE key = 'schema.version'")
            .fetch_optional(pool)
            .await
            .map_err(AppError::db)?;
    Ok(value.and_then(|text| text.parse().ok()).unwrap_or(0))
}

/// 仅当列不存在时执行 `ALTER TABLE ... ADD COLUMN`（幂等守卫）。
///
/// `table` / `column` / `def` 均取自本模块常量（非用户输入）；SQLite 的 DDL 不支持参数绑定。
pub async fn ensure_column(
    pool: &SqlitePool,
    table: &str,
    column: &str,
    def: &str,
) -> AppResult<()> {
    if column_exists(pool, table, column).await? {
        return Ok(());
    }
    let sql = format!("ALTER TABLE {table} ADD COLUMN {column} {def}");
    sqlx::query(&sql)
        .execute(pool)
        .await
        .map_err(AppError::db)?;
    Ok(())
}

/// 列是否存在（`PRAGMA table_info`）。
async fn column_exists(pool: &SqlitePool, table: &str, column: &str) -> AppResult<bool> {
    let sql = format!("PRAGMA table_info({table})");
    let rows = sqlx::query(&sql)
        .fetch_all(pool)
        .await
        .map_err(AppError::db)?;
    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == column))
}

/// 执行一段多语句 SQL。
async fn run_raw(pool: &SqlitePool, sql: &str) -> AppResult<()> {
    sqlx::raw_sql(sql)
        .execute(pool)
        .await
        .map_err(AppError::db)?;
    Ok(())
}
