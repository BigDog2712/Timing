use crate::services::insight::data::schema;
use crate::services::insight::data::schema_contracts;
use crate::services::insight::data::sqlite_error::SqliteOperationError;
use crate::infra::insight::storage_paths;
use futures_util::future::BoxFuture;
use sqlx::error::BoxDynError;
use sqlx::migrate::{Migration as SqlxMigration, MigrationSource, MigrationType, Migrator};
use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
use sqlx::{Pool, Row, Sqlite};
use std::fs::create_dir_all;
use std::future::Future;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, Runtime};
use tokio::sync::RwLock;
use tokio::time::{sleep, Duration};
pub(crate) mod diagnostics;
#[cfg(test)]
mod widget_retirement_tests;

#[derive(Default)]
pub struct AppSqlitePool(pub(crate) RwLock<Option<Pool<Sqlite>>>);

pub(crate) async fn register_sqlite_pool(state: &AppSqlitePool, pool: Pool<Sqlite>) {
    let previous = state.0.write().await.replace(pool);
    if let Some(previous) = previous {
        previous.close().await;
    }
}
const VALIDATED_SCHEMA_MIGRATION_HEAD: i64 = schema::FOCUS_HISTORY_VERSION;
mod activity_read_model_schema;
pub(super) mod import_schema;
mod maintenance;
mod restore;
pub(super) use activity_read_model_schema::has_activity_read_models_schema;
use import_schema::{has_import_data_schema, has_import_data_v6_schema};
#[cfg(test)]
pub(crate) use maintenance::QUERY_STATISTICS_OPTIMIZE_MASK;
pub(crate) use maintenance::{
    acquire_sqlite_maintenance, checkpoint_sqlite_pool, optimize_query_statistics,
};
pub(crate) use restore::replace_product_db_from_candidate;

#[derive(Debug)]
struct InlineMigrationList(Vec<schema::Migration>);

impl MigrationSource<'static> for InlineMigrationList {
    fn resolve(self) -> BoxFuture<'static, Result<Vec<SqlxMigration>, BoxDynError>> {
        Box::pin(async move {
            let mut migrations = Vec::new();
            for migration in self.0 {
                migrations.push(SqlxMigration::new(
                    migration.version,
                    migration.description.into(),
                    MigrationType::ReversibleUp,
                    migration.sql.into(),
                    false,
                ));
            }
            Ok(migrations)
        })
    }
}

pub(crate) fn expected_migration_metadata() -> Vec<(i64, &'static str, Vec<u8>)> {
    schema::tracker_migrations()
        .into_iter()
        .map(|migration| {
            let sqlx_migration = SqlxMigration::new(
                migration.version,
                migration.description.into(),
                MigrationType::ReversibleUp,
                migration.sql.into(),
                false,
            );
            (
                migration.version,
                migration.description,
                sqlx_migration.checksum.into_owned(),
            )
        })
        .collect()
}

pub(crate) fn resolve_product_db_path<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    let paths = storage_paths::resolve_storage_paths(app)?;
    create_dir_all(&paths.data_root).map_err(|error| {
        format!(
            "failed to create app data dir `{}`: {error}",
            paths.data_root.display()
        )
    })?;
    Ok(paths.db_path)
}

pub(crate) async fn open_single_connection_sqlite_pool(
    db_path: &Path,
    create_if_missing: bool,
) -> Result<Pool<Sqlite>, String> {
    let connect_options = SqliteConnectOptions::new()
        .filename(db_path)
        .create_if_missing(create_if_missing)
        .pragma("busy_timeout", "5000")
        .pragma("foreign_keys", "ON");

    SqlitePoolOptions::new()
        .max_connections(1)
        .connect_with(connect_options)
        .await
        .map_err(|error| format!("failed to open sqlite db `{}`: {error}", db_path.display()))
}

pub async fn reopen_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let _maintenance = acquire_sqlite_maintenance().await;
    reopen_sqlite_pool_unlocked(app).await
}

async fn reopen_sqlite_pool_unlocked<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<Pool<Sqlite>, String> {
    let db_path = resolve_product_db_path(app)?;
    let next_pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    let state = app
        .try_state::<AppSqlitePool>()
        .ok_or_else(|| "application sqlite state is not available".to_string())?;
    register_sqlite_pool(&state, next_pool.clone()).await;

    Ok(next_pool)
}

pub async fn run_recoverable_sqlite_write<R, F, Fut>(
    app: &AppHandle<R>,
    context: &'static str,
    write: F,
) -> Result<(), SqliteOperationError>
where
    R: Runtime,
    F: Fn(Pool<Sqlite>) -> Fut,
    Fut: Future<Output = Result<(), SqliteOperationError>>,
{
    let pool = wait_for_sqlite_pool(app)
        .await
        .map_err(|error| SqliteOperationError::operation_failed(context, error))?;
    match write(pool).await {
        Ok(()) => Ok(()),
        Err(error) if error.retryable() => {
            let reopened_pool = reopen_sqlite_pool(app).await.map_err(|reopen_error| {
                SqliteOperationError::operation_failed(context, reopen_error)
            })?;
            write(reopened_pool).await
        }
        Err(error) => Err(error),
    }
}

pub async fn initialize_app_sqlite<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let db_path = resolve_product_db_path(app)?;
    restore::recover_interrupted_db_restore(&db_path).await?;
    let pool = open_single_connection_sqlite_pool(&db_path, true).await?;

    prepare_pool_schema(&pool, &db_path).await?;

    let state = app
        .try_state::<AppSqlitePool>()
        .ok_or_else(|| "application sqlite state is not available".to_string())?;
    register_sqlite_pool(&state, pool).await;

    Ok(())
}

pub(crate) async fn prepare_pool_schema(pool: &Pool<Sqlite>, db_path: &Path) -> Result<(), String> {
    validate_schema_inspection_coverage()?;

    if repair_legacy_schema_before_baseline_normalization(pool).await? {
        eprintln!("[sql] repaired legacy sqlite schema before baseline normalization");
    }

    if normalize_current_baseline_migration_history_for_pool(pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current schema");
    }

    run_current_migrations(pool).await?;

    if normalize_current_baseline_migration_history_for_pool(pool).await? {
        eprintln!("[sql] normalized sqlite migration history to the current schema");
    }

    if !has_current_schema(pool).await? {
        return Err(format!(
            "sqlite schema validation failed for `{}`",
            db_path.display()
        ));
    }

    Ok(())
}

fn validate_schema_inspection_coverage() -> Result<(), String> {
    let registered_head = schema::tracker_migrations()
        .iter()
        .map(|migration| migration.version)
        .max()
        .unwrap_or_default();
    if registered_head != VALIDATED_SCHEMA_MIGRATION_HEAD {
        return Err(format!(
            "sqlite schema inspection covers migration head {VALIDATED_SCHEMA_MIGRATION_HEAD}, but registered head is {registered_head}"
        ));
    }
    Ok(())
}

async fn run_current_migrations(pool: &Pool<Sqlite>) -> Result<(), String> {
    let migrator = Migrator::new(InlineMigrationList(schema::tracker_migrations()))
        .await
        .map_err(|error| format!("failed to prepare sqlite migrations: {error}"))?;
    migrator
        .run(pool)
        .await
        .map_err(|error| format!("failed to run sqlite migrations: {error}"))
}

async fn table_exists(pool: &Pool<Sqlite>, table_name: &str) -> Result<bool, String> {
    sqlx::query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1")
        .bind(table_name)
        .fetch_optional(pool)
        .await
        .map(|row| row.is_some())
        .map_err(|error| format!("failed to inspect sqlite table `{table_name}`: {error}"))
}

async fn table_has_columns(
    pool: &Pool<Sqlite>,
    table_name: &str,
    required_columns: &[&str],
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA table_info(sessions)",
        "session_title_samples" => "PRAGMA table_info(session_title_samples)",
        "settings" => "PRAGMA table_info(settings)",
        "icon_cache" => "PRAGMA table_info(icon_cache)",
        "tool_reminders" => "PRAGMA table_info(tool_reminders)",
        "tool_pomodoro_runs" => "PRAGMA table_info(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA table_info(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA table_info(tool_software_reminder_rules)",
        "web_activity_segments" => "PRAGMA table_info(web_activity_segments)",
        "web_favicon_cache" => "PRAGMA table_info(web_favicon_cache)",
        "read_model_revision" => "PRAGMA table_info(read_model_revision)",
        "read_model_state" => "PRAGMA table_info(read_model_state)",
        "activity_summary_dirty_ranges" => "PRAGMA table_info(activity_summary_dirty_ranges)",
        "app_catalog_dirty_keys" => "PRAGMA table_info(app_catalog_dirty_keys)",
        "recorded_app_catalog" => "PRAGMA table_info(recorded_app_catalog)",
        "activity_hourly_effective" => "PRAGMA table_info(activity_hourly_effective)",
        _ => {
            return Err(format!(
                "unsupported schema inspection table `{table_name}`"
            ))
        }
    };

    let rows = sqlx::query(pragma).fetch_all(pool).await.map_err(|error| {
        format!("failed to inspect sqlite table `{table_name}` columns: {error}")
    })?;
    let columns = rows
        .iter()
        .map(|row| row.get::<String, _>("name"))
        .collect::<Vec<_>>();

    Ok(required_columns
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

async fn sessions_has_column(pool: &Pool<Sqlite>, column_name: &str) -> Result<bool, String> {
    table_has_columns(pool, "sessions", &[column_name]).await
}

async fn sessions_has_index(pool: &Pool<Sqlite>, index_name: &str) -> Result<bool, String> {
    table_has_index(pool, "sessions", index_name).await
}

async fn table_has_index(
    pool: &Pool<Sqlite>,
    table_name: &str,
    index_name: &str,
) -> Result<bool, String> {
    let pragma = match table_name {
        "sessions" => "PRAGMA index_list(sessions)",
        "session_title_samples" => "PRAGMA index_list(session_title_samples)",
        "tool_reminders" => "PRAGMA index_list(tool_reminders)",
        "tool_pomodoro_runs" => "PRAGMA index_list(tool_pomodoro_runs)",
        "tool_daily_stats" => "PRAGMA index_list(tool_daily_stats)",
        "tool_software_reminder_rules" => "PRAGMA index_list(tool_software_reminder_rules)",
        "web_activity_segments" => "PRAGMA index_list(web_activity_segments)",
        "activity_summary_dirty_ranges" => "PRAGMA index_list(activity_summary_dirty_ranges)",
        "app_catalog_dirty_keys" => "PRAGMA index_list(app_catalog_dirty_keys)",
        "recorded_app_catalog" => "PRAGMA index_list(recorded_app_catalog)",
        "activity_hourly_effective" => "PRAGMA index_list(activity_hourly_effective)",
        _ => return Err(format!("unsupported index inspection table `{table_name}`")),
    };

    let rows = sqlx::query(pragma)
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to inspect {table_name} indexes: {error}"))?;

    Ok(rows
        .iter()
        .any(|row| row.get::<String, _>("name") == index_name))
}

async fn ensure_sessions_continuity_group_start_time(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if sessions_has_column(pool, "continuity_group_start_time").await? {
        return Ok(false);
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to start sqlite legacy schema repair: {error}"))?;

    sqlx::query("ALTER TABLE sessions ADD COLUMN continuity_group_start_time INTEGER")
        .execute(&mut *tx)
        .await
        .map_err(|error| {
            format!(
                "failed to add sessions.continuity_group_start_time during schema repair: {error}"
            )
        })?;
    sqlx::query(
        "UPDATE sessions
         SET continuity_group_start_time = start_time
         WHERE continuity_group_start_time IS NULL",
    )
    .execute(&mut *tx)
    .await
    .map_err(|error| {
        format!(
            "failed to backfill sessions.continuity_group_start_time during schema repair: {error}"
        )
    })?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit sqlite legacy schema repair: {error}"))?;

    Ok(true)
}

async fn ensure_current_indexes(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !sessions_has_index(pool, "idx_sessions_date").await? {
        sqlx::query("CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(start_time)")
            .execute(pool)
            .await
            .map_err(|error| format!("failed to create sessions date index: {error}"))?;
        changed = true;
    }

    if !sessions_has_index(pool, "idx_sessions_single_active").await? {
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
        changed = true;
    }

    Ok(changed)
}

async fn ensure_session_title_samples_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    let mut changed = false;

    if !table_exists(pool, "session_title_samples").await? {
        sqlx::query(
            "CREATE TABLE IF NOT EXISTS session_title_samples (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id INTEGER NOT NULL,
                title TEXT NOT NULL,
                start_time INTEGER NOT NULL,
                end_time INTEGER,
                FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
            )",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples table: {error}"))?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_session_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_session_time
             ON session_title_samples(session_id, start_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| {
            format!("failed to create session_title_samples session/time index: {error}")
        })?;
        changed = true;
    }

    if !table_has_index(
        pool,
        "session_title_samples",
        "idx_session_title_samples_time",
    )
    .await?
    {
        sqlx::query(
            "CREATE INDEX IF NOT EXISTS idx_session_title_samples_time
             ON session_title_samples(start_time, end_time)",
        )
        .execute(pool)
        .await
        .map_err(|error| format!("failed to create session_title_samples time index: {error}"))?;
        changed = true;
    }

    let inserted = sqlx::query(
        "INSERT INTO session_title_samples (session_id, title, start_time, end_time)
         SELECT id, TRIM(window_title), start_time, end_time
         FROM sessions
         WHERE TRIM(COALESCE(window_title, '')) <> ''
           AND NOT EXISTS (
             SELECT 1
             FROM session_title_samples
             WHERE session_title_samples.session_id = sessions.id
           )",
    )
    .execute(pool)
    .await
    .map_err(|error| format!("failed to backfill legacy title samples: {error}"))?
    .rows_affected();

    Ok(changed || inserted > 0)
}

async fn repair_legacy_schema_before_baseline_normalization(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "sessions").await? {
        return Ok(false);
    }

    let mut changed = ensure_sessions_continuity_group_start_time(pool).await?;
    changed = ensure_session_title_samples_schema(pool).await? || changed;
    // Only the known earlier definition is repairable; unknown indexes still fail validation.
    const LEGACY_TARGET_INDEX: &str =
        "CREATE UNIQUE INDEX idx_tool_activity_reminder_rules_unique_target
        ON tool_activity_reminder_rules(target_kind, CASE target_kind
            WHEN 'app' THEN CASE WHEN NULLIF(TRIM(exe_name), '') IS NOT NULL
                THEN 'exe:' || LOWER(TRIM(exe_name)) ELSE 'name:' || LOWER(TRIM(app_name)) END
            WHEN 'category' THEN TRIM(category_id)
            WHEN 'web' THEN LOWER(TRIM(TRIM(normalized_domain), '.'))
        END) WHERE disabled_at IS NULL";
    if schema_contracts::activity_target_index_matches(pool, LEGACY_TARGET_INDEX).await? {
        let mut tx = pool.begin().await.map_err(|error| {
            format!("failed to start legacy activity reminder index repair: {error}")
        })?;
        sqlx::query("DROP INDEX idx_tool_activity_reminder_rules_unique_target")
            .execute(&mut *tx)
            .await
            .map_err(|error| format!("failed to remove legacy activity reminder index: {error}"))?;
        // Deduplication and replacement are atomic; an error restores the legacy index and rows.
        sqlx::Executor::execute(&mut *tx, schema::ACTIVITY_REMINDER_UNIQUE_TARGET_SQL)
            .await
            .map_err(|error| format!("failed to rebuild activity reminder index: {error}"))?;
        tx.commit()
            .await
            .map_err(|error| format!("failed to commit activity reminder index repair: {error}"))?;
        changed = true;
    }

    if has_current_baseline_schema(pool).await? {
        return Ok(changed);
    }

    let sessions_base_ready = table_has_columns(
        pool,
        "sessions",
        &[
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
        ],
    )
    .await?;

    if sessions_base_ready {
        changed = ensure_current_indexes(pool).await? || changed;
    }

    Ok(changed)
}

pub(super) async fn has_current_baseline_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
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
            "id",
            "app_name",
            "exe_name",
            "window_title",
            "start_time",
            "end_time",
            "duration",
            "continuity_group_start_time",
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
    let active_index_ready = sessions_has_index(pool, "idx_sessions_single_active").await?;
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

pub(super) async fn has_base_tools_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "tool_reminders").await?
        || !table_exists(pool, "tool_pomodoro_runs").await?
        || !table_exists(pool, "tool_daily_stats").await?
    {
        return Ok(false);
    }

    let reminders_ready = table_has_columns(
        pool,
        "tool_reminders",
        &[
            "id",
            "label",
            "scheduled_at",
            "created_at",
            "status",
            "fired_at",
            "cancelled_at",
        ],
    )
    .await?;
    let pomodoros_ready = table_has_columns(
        pool,
        "tool_pomodoro_runs",
        &[
            "id",
            "phase",
            "status",
            "cycle_index",
            "focus_ms",
            "short_break_ms",
            "long_break_ms",
            "long_break_every",
            "phase_started_at",
            "phase_paused_at",
            "phase_remaining_ms",
            "completed_focus_count",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let daily_ready = table_has_columns(
        pool,
        "tool_daily_stats",
        &["date_key", "completed_pomodoros", "updated_at"],
    )
    .await?;
    let reminder_index_ready =
        table_has_index(pool, "tool_reminders", "idx_tool_reminders_schedule_status").await?;
    let pomodoro_index_ready = table_has_index(
        pool,
        "tool_pomodoro_runs",
        "idx_tool_pomodoro_runs_status_updated",
    )
    .await?;
    let daily_index_ready =
        table_has_index(pool, "tool_daily_stats", "idx_tool_daily_stats_updated").await?;

    Ok(reminders_ready
        && pomodoros_ready
        && daily_ready
        && reminder_index_ready
        && pomodoro_index_ready
        && daily_index_ready)
}

pub(super) async fn has_software_reminder_rules_schema(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "tool_software_reminder_rules").await? {
        return Ok(false);
    }

    let software_rules_ready = table_has_columns(
        pool,
        "tool_software_reminder_rules",
        &[
            "id",
            "app_name",
            "exe_name",
            "limit_ms",
            "message",
            "created_at",
            "updated_at",
            "disabled_at",
            "last_fired_date_key",
        ],
    )
    .await?;
    let software_rules_index_ready = table_has_index(
        pool,
        "tool_software_reminder_rules",
        "idx_tool_software_reminder_rules_active",
    )
    .await?;
    let sessions_app_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_app_usage_time").await?;
    let sessions_exe_usage_index_ready =
        table_has_index(pool, "sessions", "idx_sessions_exe_usage_time").await?;

    Ok(software_rules_ready
        && software_rules_index_ready
        && sessions_app_usage_index_ready
        && sessions_exe_usage_index_ready)
}

pub(super) async fn has_web_activity_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "web_activity_segments").await? {
        return Ok(false);
    }

    let segments_ready = table_has_columns(
        pool,
        "web_activity_segments",
        &[
            "id",
            "browser_client_id",
            "browser_kind",
            "browser_exe_name",
            "domain",
            "normalized_domain",
            "url",
            "title",
            "favicon_url",
            "start_time",
            "end_time",
            "duration",
            "source",
            "created_at",
            "updated_at",
        ],
    )
    .await?;
    let time_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_time",
    )
    .await?;
    let domain_time_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_domain_time",
    )
    .await?;
    let single_active_index_ready = table_has_index(
        pool,
        "web_activity_segments",
        "idx_web_activity_segments_single_active",
    )
    .await?;
    Ok(segments_ready && time_index_ready && domain_time_index_ready && single_active_index_ready)
}

pub(super) async fn has_web_favicon_cache_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
    if !table_exists(pool, "web_favicon_cache").await? {
        return Ok(false);
    }

    table_has_columns(
        pool,
        "web_favicon_cache",
        &["normalized_domain", "favicon_url", "updated_at"],
    )
    .await
}

async fn has_current_schema(pool: &Pool<Sqlite>) -> Result<bool, String> {
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
        has_current_baseline_schema(pool).await?,
        has_base_tools_schema(pool).await?,
        schema_contracts::has_activity_reminder_rules_schema(pool).await?,
        has_web_activity_schema(pool).await?,
        has_web_favicon_cache_schema(pool).await?,
        has_import_data_schema(pool).await?,
        has_activity_read_models_schema(pool).await?,
        schema_contracts::has_web_activity_revision_schema(pool).await?,
        schema_contracts::has_scheduled_backup_schema(pool).await?,
        schema_contracts::has_scheduled_export_schema(pool).await?,
    ];
    Ok(checks.into_iter().all(|ready| ready))
}

async fn normalize_current_baseline_migration_history_for_pool(
    pool: &Pool<Sqlite>,
) -> Result<bool, String> {
    if !table_exists(pool, "_sqlx_migrations").await? {
        return Ok(false);
    }

    if !has_current_baseline_schema(pool).await? {
        return Ok(false);
    }

    let mut expected = expected_migration_metadata();
    if !has_base_tools_schema(pool).await? {
        expected.truncate(1);
    } else if !has_software_reminder_rules_schema(pool).await?
        && !schema_contracts::has_activity_reminder_rules_schema(pool).await?
    {
        expected.truncate(2);
    } else if !has_web_activity_schema(pool).await? {
        expected.truncate(3);
    } else if !has_web_favicon_cache_schema(pool).await? {
        expected.truncate(4);
    } else if !has_import_data_schema(pool).await? {
        expected.truncate(if has_import_data_v6_schema(pool).await? {
            6
        } else {
            5
        });
    } else if !has_activity_read_models_schema(pool).await? {
        expected.truncate(schema::IMPORT_DATA_ISOLATION_MIGRATION_VERSION as usize);
    }
    let revision_limit = schema_contracts::schema_revision_limit(pool).await?;
    expected.truncate(expected.len().min(revision_limit));
    if expected.is_empty() {
        return Ok(false);
    }

    let applied_rows = sqlx::query("SELECT version, description, checksum FROM _sqlx_migrations")
        .fetch_all(pool)
        .await
        .map_err(|error| format!("failed to load applied sqlite migrations: {error}"))?;

    let already_normalized = applied_rows.len() == expected.len()
        && expected.iter().all(|(version, description, checksum)| {
            applied_rows.iter().any(|row| {
                row.get::<i64, _>("version") == *version
                    && row.get::<String, _>("description") == *description
                    && row.get::<Vec<u8>, _>("checksum") == *checksum
            })
        });

    if already_normalized {
        return Ok(false);
    }

    let mut tx = pool.begin().await.map_err(|error| {
        format!("failed to start sqlite migration history normalization: {error}")
    })?;
    sqlx::query("DELETE FROM _sqlx_migrations")
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to clear sqlite migration history: {error}"))?;
    for (version, description, checksum) in expected {
        sqlx::query(
            "INSERT INTO _sqlx_migrations (version, description, success, checksum, execution_time)
             VALUES (?, ?, 1, ?, 0)",
        )
        .bind(version)
        .bind(description)
        .bind(checksum)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("failed to write sqlite current migration history: {error}"))?;
    }
    tx.commit().await.map_err(|error| {
        format!("failed to commit sqlite migration history normalization: {error}")
    })?;

    Ok(true)
}

pub async fn wait_for_sqlite_pool<R: Runtime>(app: &AppHandle<R>) -> Result<Pool<Sqlite>, String> {
    let mut wait_cycles: u64 = 0;

    loop {
        if let Some(state) = app.try_state::<AppSqlitePool>() {
            if let Some(pool) = state.0.read().await.as_ref() {
                return Ok(pool.clone());
            }
        }

        wait_cycles += 1;
        if wait_cycles > 300 {
            return Err("sqlite pool not available in time".to_string());
        }

        sleep(Duration::from_millis(100)).await;
    }
}

#[cfg(test)]
#[path = "sqlite_pool_mod_tests.rs"]
mod tests;
