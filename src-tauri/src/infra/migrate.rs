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

mod tombstone;

use crate::error::{AppError, AppResult};

/// V0.2.0 加列清单 `(表, 列, 定义)`。定义与 `schema-V0.2.0.sql` 目标 DDL 对齐；
/// 旧库经 `ALTER` 补齐后**不带 CHECK**（SQLite 限制），取值由应用层保证（架构 §4.3）。
const MIGRATE_COLUMNS: &[(&str, &str, &str)] = &[
    ("items", "remind_at", "INTEGER"),
    ("items", "reminded_at", "INTEGER"),
    ("items", "is_pinned", "INTEGER NOT NULL DEFAULT 0"),
    ("time_records", "mode", "TEXT NOT NULL DEFAULT 'countup'"),
    ("time_records", "target_sec", "INTEGER"),
];

/// V0.3.0 加列清单。**必须晚于 `0002_v020.sql`**（`notes` 表由它创建）。
///
/// `DEFAULT 1` = 置顶：V0.2.x 的便利贴窗口硬编码 `always_on_top=true`，默认 1 让
/// 老数据升级后行为不变（ADR-019）。
const MIGRATE_COLUMNS_V3: &[(&str, &str, &str)] =
    &[("notes", "is_pinned", "INTEGER NOT NULL DEFAULT 1")];

/// V0.3.12 加列清单（待办提醒链路，ADR-030）。**必须晚于 `0002_v020.sql`**（`todos` 由它创建）。
///
/// - `remind_stage`：0 未提醒 / 1 轻提醒已弹 / 2 五分钟询问已弹（单调递进，替代单次 `reminded_at`）；
/// - `auto_start`：1 = 用户答应「当前事项结束后自动开始」。
const MIGRATE_COLUMNS_V4: &[(&str, &str, &str)] = &[
    ("todos", "remind_stage", "INTEGER NOT NULL DEFAULT 0"),
    ("todos", "auto_start", "INTEGER NOT NULL DEFAULT 0"),
];

/// V0.11.3 加列清单：待办绑定事项。
///
/// 可空 —— 老数据不回填（回填等于重跑一次标题匹配，同名待办会被绑成一条），
/// 新建时也不强制选事项。空值由 `todo_start` 兜底并回填，见 `services::todo_start`。
const MIGRATE_COLUMNS_V5: &[(&str, &str, &str)] = &[("todos", "item_id", "INTEGER")];

/// 0.12.2 加列清单（设备维度）。
///
/// `device_id` 的 `DEFAULT ''` 是**迁移期哨兵**，由 `services::device` 在启动时改写成
/// 真实 `install_id`。用 `''` 而不是方案书写的 `'local'`：`'local'` 会与「本机 id 就叫
/// local」混淆，而空串在所有 `CHECK(TRIM(device_id) <> '')` 之外的地方都能被自然忽略。
///
/// 走 `ensure_column`（`PRAGMA table_info` 守卫）而不是裸 `ALTER`：SQLite 没有
/// `ADD COLUMN IF NOT EXISTS`，而本函数每次启动都会跑（K-13）。
const MIGRATE_COLUMNS_V9: &[(&str, &str, &str)] = &[
    ("time_records", "device_id", "TEXT NOT NULL DEFAULT ''"),
    ("time_records", "uid", "TEXT"),
    ("time_records", "merged_into_uid", "TEXT"),
];

/// 0.12.2 加列清单（同步簿记）。
///
/// 只负责「列在不在」：盖戳由 `0010_v0141_sync_bookkeeping_guard.sql` 里的触发器做
/// （不能依赖调用点记得写——写入口有四个，漏一个就是「那批行永远不会被导出且零报错」）。
const MIGRATE_COLUMNS_V10: &[(&str, &str, &str)] =
    &[("time_records", "updated_at_ms", "INTEGER NOT NULL DEFAULT 0")];

/// 0.13.x 加列清单（事项归属）。
///
/// `parent_id` / `depth` / `category_key` 是「事项升为主数据」的三件：树、深度、分类。
/// 深度硬限 2 层由应用层守（`depth <= 1`），不写成 CHECK：ALTER 加的列在 SQLite 上
/// 带不了 CHECK，而新库的 DDL 与旧库的列定义一旦不一致，就会出现「新库拦得住、
/// 旧库拦不住」的分裂——取值合法性统一由 `services::item` 保证。
///
/// `device_id` 的 `DEFAULT ''` 与 `time_records` 同义（迁移期哨兵），由
/// `services::device::startup_business_identity` 认领。
const MIGRATE_COLUMNS_V11: &[(&str, &str, &str)] = &[
    ("items", "parent_id", "INTEGER"),
    ("items", "depth", "INTEGER NOT NULL DEFAULT 0"),
    ("items", "category_key", "TEXT"),
    ("items", "device_id", "TEXT NOT NULL DEFAULT ''"),
    ("items", "uid", "TEXT"),
    ("items", "updated_at_ms", "INTEGER NOT NULL DEFAULT 0"),
];

/// 执行全部迁移（幂等）。由 `infra::db::init_pool` 调用。
pub async fn migrate(pool: &SqlitePool) -> AppResult<()> {
    // ① 3 张基表（IF NOT EXISTS，幂等）
    run_raw(pool, include_str!("../migrations/0001_init.sql")).await?;
    // ② 补 v2 列（必须早于建索引，K-13）
    for (table, column, def) in MIGRATE_COLUMNS {
        ensure_column(pool, table, column, def).await?;
    }
    // ③ 建 notes/todos + 全部 V0.2.0 索引 + settings 种子 + schema.version=2（幂等）
    run_raw(pool, include_str!("../migrations/0002_v020.sql")).await?;
    // ④ 补 v3 列（必须在 notes 建好之后）
    for (table, column, def) in MIGRATE_COLUMNS_V3 {
        ensure_column(pool, table, column, def).await?;
    }
    // ⑤ v3 版本推进（schema.version=3）
    run_raw(pool, include_str!("../migrations/0003_v030.sql")).await?;
    // ⑥ 补 v4 列（待办提醒链路）
    for (table, column, def) in MIGRATE_COLUMNS_V4 {
        ensure_column(pool, table, column, def).await?;
    }
    // ⑦ v4 版本推进（schema.version=4）
    run_raw(pool, include_str!("../migrations/0004_v0312.sql")).await?;
    // ⑧ 补 v5 列（待办绑定事项；必须在 todos 表建好之后）
    for (table, column, def) in MIGRATE_COLUMNS_V5 {
        ensure_column(pool, table, column, def).await?;
    }
    // ⑨ v5 版本推进（schema.version=5）+ 索引
    run_raw(pool, include_str!("../migrations/0005_v0113.sql")).await?;
    // ⑩ v6 版本推进（schema.version=6）+ 云端待传队列表 `md_cloud_pending`
    //
    // 只建新表、不动既有表，所以没有「补列」这一步，也就不会撞 K-13。
    // 语句顺序是「先建表、后推版本」：中途失败时库仍停在 v5 且表已存在，
    // 下一次启动重跑本文件即可（建表带 IF NOT EXISTS），不会留下「版本说 6、
    // 表却不在」这种只有人工 SQL 才能修的残局。错误一律向上抛给 `init_pool`，
    // 由启动期决定是回滚还是弹迁移失败框——这里不吞、不降级。
    run_raw(pool, include_str!("../migrations/0006_v0113.sql")).await?;
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
    // ⑬ v9（0.12.2）：设备维度。
    //
    // 三步，顺序不可换：
    //   ① 补列 —— 幂等守卫（PRAGMA），每次启动都跑，顺带修复"被人手工删过列"的库；
    //   ② 抵消段 —— **每次启动无条件跑**：`0002_v020.sql` 每次启动都会把
    //      `uq_records_open`（全库单活跃）建回来，这里 DROP 是唯一抵消点。
    //      加了版本门 = 第二次启动退化回单设备；
    //   ③ 版本推进 —— 必须在版本门里：`UPDATE … value='9'` 会把更高的版本号改写回 9。
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
    Ok(())
}



/// 读 `settings.schema.version`（缺失按 0：全新库的种子在 0002 里写入）。
async fn schema_version(pool: &SqlitePool) -> AppResult<i64> {
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
