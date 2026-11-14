//! 「当前 schema」的就绪判定与索引修复（原本压在 `sqlite_pool.rs` 的冻结线上）。
//!
//! 三个判据别混用：`has_current_schema` = 启动验收（全部契约，含设备维度）；
//! `has_current_baseline_layout` = 28 起的基线布局；`has_current_baseline_schema` =
//! **28 之前**的基线布局，28 之后恒为假。最后那条为什么必须恒为假、以及
//! `ensure_current_indexes` 为什么分成两支，见各自函数上的注释。

use super::{sessions_has_column, sessions_has_index, table_exists, table_has_columns, table_has_index};
use crate::services::insight::data::schema_contracts;
use sqlx::{Pool, Sqlite};

/// 每设备一条进行中（迁移 28 建）。名字进就绪判定，改它等于改 schema 契约。
const OPEN_SESSION_INDEX_PER_DEVICE: &str = "uq_sessions_open_per_device";

/// 28 之前的「全库只能有一条进行中」。只在迁移 28 之前有意义。
const LEGACY_SINGLE_ACTIVE_INDEX: &str = "idx_sessions_single_active";

/// 导入侧的一个纯索引（`IMPORT_DATA_SCHEMA_SQL` 里定义）。
///
/// 它单独出现在修复路径里是因为一条既有用例（`missing_import_index_is_repaired…`）：
/// 迁移 28 之前，索引被删是靠「历史归一化把账本截短 → Migrator 重跑那条迁移」自愈的；
/// 28 之后那条路整体关闭（见文件头），所以自愈的落点改到这里。
const IMPORT_BUCKET_EXE_INDEX: &str = "idx_import_time_buckets_exe_time";
const IMPORT_BUCKET_EXE_INDEX_SQL: &str = "CREATE INDEX IF NOT EXISTS idx_import_time_buckets_exe_time
     ON import_time_buckets(exe_name COLLATE NOCASE, bucket_start_time)";

/// 补齐当前版本需要的索引（幂等）。返回 `true` = 这一次真的写了东西。
pub(in crate::services::insight::data) async fn ensure_current_indexes(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !sessions_has_index(pool, "idx_sessions_date").await? {
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time)")
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create sessions date index: {error}"))?;
        changed = true;
    }

    if table_exists(pool, "import_time_buckets").await?
        && !table_has_index(pool, "import_time_buckets", IMPORT_BUCKET_EXE_INDEX).await?
    {
        sqlx::query(IMPORT_BUCKET_EXE_INDEX_SQL)
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create import bucket exe index: {error}"))?;
        changed = true;
    }

    // 分岔点：`device_id` 存在 = 迁移 28 已经跑过。
    if sessions_has_column(pool, "device_id").await? {
        changed = ensure_per_device_open_index(pool).await? || changed;
    } else {
        changed = ensure_legacy_single_active_index(pool).await? || changed;
    }

    Ok(changed)
}

/// 「每设备一条进行中」的修复路径。
///
/// ⚠️ 这里的 seal **必须**按 `device_id` 分组。按全库取最新一条会把另一台设备正在
/// 记录的会话清成 0 秒（旧实现的真实缺陷），而且没有任何日志。
async fn ensure_per_device_open_index(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if sessions_has_index(pool, OPEN_SESSION_INDEX_PER_DEVICE).await? {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE sessions
         SET end_time = start_time,
             duration = 0
         WHERE end_time IS NULL
           AND id IN (
             SELECT id FROM (
               SELECT id,
                      ROW_NUMBER() OVER (
                        PARTITION BY device_id
                        ORDER BY start_time DESC, id DESC
                      ) AS rn
               FROM sessions
               WHERE end_time IS NULL
             )
             WHERE rn > 1
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| {
        format!("failed to seal duplicate active sessions per device before index repair: {error}")
    })?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS uq_sessions_open_per_device
         ON sessions(device_id)
         WHERE end_time IS NULL",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to create per-device open session index: {error}"))?;
    Ok(true)
}

/// 28 之前的修复路径：全库只留最新一条 open。
///
/// 保留旧行为（含建旧索引）是**故意的**：这条路径只在迁移 28 之前跑得到，那时全库确实
/// 只该有一条 open；建出来的旧索引会在同一次启动的迁移 28 里被 `DROP INDEX` 掉。
async fn ensure_legacy_single_active_index(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if sessions_has_index(pool, LEGACY_SINGLE_ACTIVE_INDEX).await? {
        return Ok(false);
    }
    sqlx::query(
        "UPDATE sessions
         SET end_time = start_time,
             duration = 0
         WHERE end_time IS NULL
           AND id NOT IN (
             SELECT id
             FROM sessions
             WHERE end_time IS NULL
             ORDER BY start_time DESC, id DESC
             LIMIT 1
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| {
        format!("failed to seal duplicate active sessions before index repair: {error}")
    })?;
    sqlx::query(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_single_active
         ON sessions((1))
         WHERE end_time IS NULL",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to create single active session index: {error}"))?;
    Ok(true)
}

/// 启动验收：全部 schema 契约是否都成立（不成立 = `schema validation failed`）。
pub(in crate::services::insight::data) async fn has_current_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let checks = [
        schema_contracts::has_pomodoro_tasks_schema(pool).await?,
        schema_contracts::has_free_focus_schema(pool).await?,
        schema_contracts::has_reminder_identity_schema(pool).await?,
        schema_contracts::has_focus_history(pool).await?,
        schema_contracts::has_pomodoro_completions_schema(pool).await?,
        schema_contracts::has_retired_timer(pool).await?,
        schema_contracts::has_unique_activity_reminder_targets(pool).await?,
        schema_contracts::has_reminder_recurrence_schema(pool).await?,
        schema_contracts::has_activity_reminder_enabled_schema(pool).await?,
        schema_contracts::has_activity_reminder_extensions_schema(pool).await?,
        schema_contracts::has_retired_widget_preferences(pool).await?,
        schema_contracts::has_anonymous_activity_schema(pool).await?,
        schema_contracts::has_session_range_index(pool).await?,
        schema_contracts::has_web_activity_session_schema(pool).await?,
        has_current_baseline_layout(pool).await?,
        super::has_base_tools_schema(pool).await?,
        schema_contracts::has_activity_reminder_rules_schema(pool).await?,
        super::has_web_activity_schema(pool).await?,
        super::has_web_favicon_cache_schema(pool).await?,
        super::import_schema::has_import_data_schema(pool).await?,
        super::has_activity_read_models_schema(pool).await?,
        schema_contracts::has_web_activity_revision_schema(pool).await?,
        schema_contracts::has_scheduled_backup_schema(pool).await?,
        schema_contracts::has_scheduled_export_schema(pool).await?,
    ];
    Ok(checks.into_iter().all(|ready| ready))
}

/// 28 起的「基线布局」判据（启动验收用）。
///
/// = 旧基线的全部要求 **去掉** `idx_sessions_single_active`，**加上**设备维度与
/// 同步簿记的几样：`sessions.device_id / uid / app_key / updated_at_ms`、
/// `uq_sessions_open_per_device`、`devices` / `activity_daily_totals` / `sync_tombstone` 三张新表。
///
/// 只检查「列存在」，**不**检查 `device_id <> ''`：哨兵值由 `adopt_local_rows` 清理，
/// 万一它失败，宁可让用户看到一次明确的 `schema validation failed`，也不要把
/// 「库里有空 device_id」当成 schema 问题掩盖掉。
async fn has_current_baseline_layout(pool: &Pool<Sqlite>) -> Result<bool, String> {
    /* `sync_tombstone` 也进必需项：墓碑表只被同步路径读，缺了它 App 照样能跑，
       但「删过的行」会在下一次推送里**复活**（对端仍持有那条状态行）。宁可在启动
       验收时明确失败，也不要让数据在无声中回来。 */
    for table in [
        "sessions", "settings", "icon_cache", "devices", "activity_daily_totals", "sync_tombstone",
    ] {
        if !table_exists(pool, table).await? {
            return Ok(false);
        }
    }
    // `app_key` 是**生成列**：`PRAGMA table_info` 不列它（SQLite 只在 `table_xinfo` 里给
    // 生成列与隐藏列），所以它单独走一条 `table_xinfo` 查询，不能混进 `table_has_columns`。
    let sessions_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id", "app_name", "exe_name", "window_title", "start_time", "end_time",
            "duration", "continuity_group_start_time", "device_id", "uid", "updated_at_ms",
        ],
    )
    .await?;
    let app_key_ready = sqlx::query_scalar::<_, i64>(
        "SELECT COUNT(*) FROM pragma_table_xinfo('sessions') WHERE name = 'app_key'",
    )
    .fetch_one(pool)
    .await
    .map_err(|error| format!("failed to inspect sessions generated columns: {error}"))?
        == 1;
    let title_samples_ready = table_has_columns(
        pool,
        "session_title_samples",
        &["id", "session_id", "title", "start_time", "end_time"],
    )
    .await?;
    let settings_ready = table_has_columns(pool, "settings", &["key", "value"]).await?;
    let icon_cache_ready = table_has_columns(
        pool,
        "icon_cache",
        &["exe_name", "icon_base64", "last_updated"],
    )
    .await?;
    Ok(sessions_ready
        && app_key_ready
        && title_samples_ready
        && settings_ready
        && icon_cache_ready
        && sessions_has_index(pool, "idx_sessions_date").await?
        && sessions_has_index(pool, OPEN_SESSION_INDEX_PER_DEVICE).await?
        && table_has_index(
            pool,
            "session_title_samples",
            "idx_session_title_samples_session_time",
        )
        .await?
        && table_has_index(pool, "session_title_samples", "idx_session_title_samples_time").await?)
}

/// 28 **之前**的基线布局判据（判 `idx_sessions_single_active`）。
///
/// 只服务两个决策点：legacy 修复要不要跑、迁移历史要不要归一。
///
/// ⚠️ 它在 28 之后**必须**恒为假，这是安全方向而不是遗漏：它是
/// `normalize_current_baseline_migration_history_for_pool` 的闸门，而那个函数会整表
/// 重写 `_sqlx_migrations`；`schema_contracts::schema_revision_limit()` 的布局探测合计
/// 只数到 27（它不认识 28），闸门一旦在 28 的库上打开，改写就会删掉「28 已应用」那行
/// → 下次启动重跑迁移 28 → `duplicate column name` → 老用户开机即挂。
/// 两个决策点退化成「什么都不做」正是想要的结果。
pub(in crate::services::insight::data) async fn has_current_baseline_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await?
        || !table_exists(pool, "settings").await?
        || !table_exists(pool, "icon_cache").await?
    {
        return Ok(false);
    }

    let sessions_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id", "app_name", "exe_name", "window_title", "start_time", "end_time",
            "duration", "continuity_group_start_time",
        ],
    )
    .await?;
    let title_samples_ready = table_has_columns(
        pool,
        "session_title_samples",
        &["id", "session_id", "title", "start_time", "end_time"],
    )
    .await?;
    let settings_ready = table_has_columns(pool, "settings", &["key", "value"]).await?;
    let icon_cache_ready = table_has_columns(
        pool,
        "icon_cache",
        &["exe_name", "icon_base64", "last_updated"],
    )
    .await?;
    let date_index_ready = sessions_has_index(pool, "idx_sessions_date").await?;
    let active_index_ready = sessions_has_index(pool, LEGACY_SINGLE_ACTIVE_INDEX).await?;
    let title_sample_session_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?;
    let title_sample_time_index_ready = table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?;

    Ok(sessions_ready
        && title_samples_ready
        && settings_ready
        && icon_cache_ready
        && date_index_ready
        && active_index_ready
        && title_sample_session_index_ready
        && title_sample_time_index_ready)
}
