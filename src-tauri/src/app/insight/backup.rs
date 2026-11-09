use crate::app::insight::{desktop_behavior, tray};
use crate::services::insight::data::backup::{self, RestoreStrategy};
use crate::services::insight::data::remote_backup;
use crate::models::insight::backup::BackupError;
use crate::models::insight::events::APP_SETTINGS_CHANGED;
use crate::services::insight::engine::tracking::runtime as tracking_runtime;
use tauri::{AppHandle, Emitter, Manager};

pub(crate) async fn restore_backup_and_refresh(
    app: AppHandle,
    backup_path: String,
    hash: String,
    strategy: RestoreStrategy,
) -> Result<(), BackupError> {
    let prepared = backup::prepare_backup_restore(&backup_path, &hash, strategy).await?;
    let scheduled_backup_guard = crate::app::insight::scheduled_backup::lock_for_restore(&app).await;
    let scheduled_export_guard = crate::app::insight::scheduled_export::lock_for_restore(&app).await;
    let webdav_guard = crate::services::insight::data::remote_backup_config::CONFIG_LOCK.lock().await;
    let title_state =
        app.state::<crate::services::insight::engine::tracking::title_state::TitleRecordingRuntimeState>();
    let _title_guard = title_state.lock_update().await;
    let settings_state = app.state::<crate::app::insight::state::AppSettingsCommitState>();
    let _settings_guard = settings_state.lock().await;
    let tracking =
        app.state::<crate::services::insight::engine::tracking::runtime_snapshot::TrackingRuntimeSnapshotState>();
    let transition_guard = tracking.transition.lock().await;
    tracking.note_tracking_policy_change();
    // Merge keeps destination rows, so end the live destination interval before
    // either restore strategy can replace settings or reuse session identities.
    crate::services::insight::data::tracking_runtime::shared_from_app(&app)
        .await?
        .end_active_sessions(now_ms() as i64)
        .await
        .map_err(|error| format!("failed to stop tracking before restore: {error}"))?;
    backup::restore_prepared_backup(prepared, &app).await?;
    crate::services::insight::data::activity_read_model::wake_worker(&app);
    // Restored privacy settings must take effect before tracking resumes.
    title_state.set_enabled(false);
    title_state.invalidate_app_overrides();
    match crate::services::insight::data::tracking_runtime::shared_from_app(&app).await {
        Ok(data) => {
            if let Err(error) = title_state.initialize(data.as_ref()).await {
                crate::log_warn!("restore committed but title policy refresh failed: {error}");
            }
        }
        Err(error) => {
            crate::log_warn!("restore committed but tracking data reload failed: {error}")
        }
    }
    if strategy == RestoreStrategy::Replace {
        crate::app::insight::scheduled_backup::notify_replace_restore_while_locked(&app);
        crate::app::insight::scheduled_export::notify_replace_restore_while_locked(&app);
    }
    drop(webdav_guard);
    drop(scheduled_export_guard);
    drop(scheduled_backup_guard);
    if let Err(error) = remote_backup::cleanup_remote_backup_temp_if_owned(&app, &backup_path) {
        crate::log_warn!("restore committed but remote temp cleanup failed: {error}");
    }
    if let Err(error) = desktop_behavior::refresh_desktop_behavior_from_storage(app.clone()).await {
        crate::log_warn!("restore committed but desktop behavior refresh failed: {error}");
    }
    if let Err(error) = tray::refresh_tracking_pause_from_storage(&app).await {
        crate::log_warn!("restore committed but tracking pause refresh failed: {error}");
    }
    tracking.note_tracking_policy_change();
    drop(transition_guard);
    if let Err(error) = app.emit(APP_SETTINGS_CHANGED, serde_json::json!({})) {
        crate::log_warn!("restore committed but settings refresh event failed: {error}");
    }
    if let Err(error) =
        tracking_runtime::emit_tracking_data_changed(&app, "backup-restored", now_ms())
    {
        crate::log_warn!("restore committed but tracking refresh event failed: {error}");
    }
    Ok(())
}

fn now_ms() -> u64 {
    crate::infra::insight::clock::unix_timestamp_millis_u64()
}
