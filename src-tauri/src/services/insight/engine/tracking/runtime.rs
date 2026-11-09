use super::pause_state::TrackingPauseRuntimeState;
use super::ports::{SharedTrackingDataStore, TrackingDataStore};
use super::runtime_snapshot::TrackingRuntimeSnapshotState;
#[cfg(test)]
use super::session_timeout::seal_active_sessions_for_tracking_pause;
#[cfg(test)]
use super::startup;
use super::sustained_participation::SustainedParticipationRuntimeState;
use super::title_state::TitleRecordingRuntimeState;
use super::{active_session, continuity, transition, watchdog};
#[cfg(test)]
use crate::services::insight::data::repositories::{sessions, tracker_settings};
#[cfg(test)]
use crate::models::insight::tracking::TrackingDataChangedPayload;
use crate::models::insight::tracking::TrackingStatusSnapshot;
#[cfg(test)]
use crate::models::insight::tracking::TRACKING_REASON_TRACKING_PAUSED_SEALED;
use crate::infra::insight::windows::foreground as tracker;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tokio::time::{sleep, Duration};

#[path = "runtime/anonymous_activity.rs"]
mod anonymous_activity;
#[path = "runtime/loop_state.rs"]
mod loop_state;
#[path = "runtime/power_lifecycle.rs"]
mod power_lifecycle;
#[path = "runtime/snapshot_projection.rs"]
mod snapshot_projection;
#[path = "runtime/support.rs"]
mod support;
#[path = "runtime/window_polling.rs"]
mod window_polling;

use loop_state::{
    load_tracking_loop_state, persist_tracker_runtime_timestamps, record_committed_sample,
    TrackerTimestampPersistState, TrackingSettingsCache,
};
#[cfg(test)]
use power_lifecycle::apply_power_lifecycle_event;
use snapshot_projection::{
    clear_active_session_snapshot, emit_tracking_loop_change,
    refresh_active_session_snapshot_if_changed, should_emit_tracking_status_changed,
    update_runtime_snapshot_state,
};
pub use support::emit_tracking_data_changed;
use support::{log_tracker_error, now_ms};
use window_polling::poll_active_window_with_timeout;

// Owner ledger: run() owns runtime loop orchestration only. Polling,
// loop-state loading, power lifecycle handling, and event support stay in the
// sibling runtime/* modules so commands.rs and lib.rs remain thin IPC entrypoints.
pub async fn run<R: Runtime>(
    app: AppHandle<R>,
    health_state: Arc<watchdog::RuntimeHealthState>,
    data: SharedTrackingDataStore,
) -> Result<(), String> {
    let progress = &health_state.progress;
    let pause_state = app.state::<TrackingPauseRuntimeState>();
    let title_state = app.state::<TitleRecordingRuntimeState>();
    let snapshot_state = app.state::<TrackingRuntimeSnapshotState>();

    let mut last_window: Option<tracker::WindowInfo> = None;
    let mut last_tracking_status: Option<TrackingStatusSnapshot> = None;
    let mut last_emitted_window: Option<tracker::WindowInfo> = None;
    let mut pending_continuity: Option<continuity::PendingContinuity> = None;
    let mut sustained_participation_state = SustainedParticipationRuntimeState::default();
    let mut timestamp_persist_state = TrackerTimestampPersistState::default();
    let mut settings_cache = TrackingSettingsCache::default();
    loop {
        let generation = snapshot_state.lifecycle_generation();
        progress.enter(watchdog::TrackingStage::Foreground);
        let poll_outcome = poll_active_window_with_timeout().await;
        if poll_outcome.is_successful_sample() {
            health_state.progress.observed();
        }
        progress.enter(watchdog::TrackingStage::TransitionLock);
        let transition_guard = snapshot_state.transition.lock().await;
        progress.enter(watchdog::TrackingStage::Persisting);
        if let Err(error) = power_lifecycle::flush_pending_power_stop_and_publish(
            &app,
            data.as_ref(),
            &snapshot_state,
        )
        .await
        {
            log_tracker_error(error);
            drop(transition_guard);
            sleep(Duration::from_secs(1)).await;
            continue;
        }
        if !snapshot_state.accepts_sample(generation) {
            last_window = None;
            pending_continuity = None;
            sustained_participation_state = SustainedParticipationRuntimeState::default();
            last_tracking_status = None;
            title_state.clear_browser_title();
            title_state.clear_anonymous_web();
            drop(transition_guard);
            sleep(Duration::from_secs(1)).await;
            continue;
        }
        if snapshot_state
            .snapshot()
            .is_some_and(|snapshot| snapshot.generation != generation)
        {
            // A stop/resume may finish between polls; previous media grace and
            // continuity are not evidence for the new lifecycle.
            last_window = None;
            title_state.clear_browser_title();
            title_state.clear_anonymous_web();
            pending_continuity = None;
            sustained_participation_state = SustainedParticipationRuntimeState::default();
            last_tracking_status = None;
        }
        let window_info = poll_outcome.window.clone();
        let now_ms = now_ms();
        snapshot_projection::publish_resolved_names(&app, data.as_ref(), now_ms).await;
        if let Some(clock_reversed) =
            loop_state::seal_stale_sample(&app, data.as_ref(), &health_state, now_ms).await?
        {
            last_window = None;
            pending_continuity = None;
            sustained_participation_state = SustainedParticipationRuntimeState::default();
            last_tracking_status = None;
            if clock_reversed {
                drop(transition_guard);
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        }
        health_state.note_heartbeat(now_ms);
        persist_tracker_runtime_timestamps(
            data.as_ref(),
            now_ms,
            false,
            &mut timestamp_persist_state,
        )
        .await;
        health_state.progress.enter(watchdog::TrackingStage::Policy);
        let (tracking_state, next_sustained_participation_state) = load_tracking_loop_state(
            data.as_ref(),
            &pause_state,
            &title_state,
            &window_info,
            now_ms,
            &sustained_participation_state,
            &mut settings_cache,
        )
        .await;
        sustained_participation_state = next_sustained_participation_state;
        progress.enter(watchdog::TrackingStage::Transition);

        let anonymous_cutoff = poll_outcome
            .is_successful_sample()
            .then(|| title_state.take_invalid_anonymous_web_cutoff(&window_info, now_ms))
            .flatten()
            .or_else(|| {
                (tracking_state.app_tracking_enabled
                    && snapshot_state.snapshot().is_some_and(|s| s.anonymous))
                .then_some(now_ms)
            })
            .filter(|_| poll_outcome.is_successful_sample());
        if let Some(cutoff) = anonymous_cutoff {
            data.seal_anonymous_activity(tracking_state.resolve_anonymous_cutoff(
                last_window.as_ref(),
                last_tracking_status.as_ref(),
                cutoff,
                now_ms,
            ))
            .await
            .map_err(|error| error.to_string())?;
        }
        progress.enter(watchdog::TrackingStage::Snapshot);
        update_runtime_snapshot_state(&app, &tracking_state, now_ms, &poll_outcome, generation);
        progress.enter(watchdog::TrackingStage::Transition);
        let stopped = match tracking_state
            .seal_stop(
                data.as_ref(),
                last_window.as_ref(),
                last_tracking_status.as_ref(),
                now_ms,
                poll_outcome.is_successful_sample(),
            )
            .await
        {
            Ok(stopped) => stopped,
            Err(error) => {
                log_tracker_error(format!("failed to seal tracking boundary: {error}"));
                clear_active_session_snapshot(&app);
                drop(transition_guard);
                sleep(Duration::from_secs(1)).await;
                continue;
            }
        };
        let tracked_window = tracking_state.tracked_window;
        if let Some(stopped) = stopped {
            record_committed_sample(
                data.as_ref(),
                &health_state,
                now_ms,
                poll_outcome.is_successful_sample(),
                &mut timestamp_persist_state,
            )
            .await;
            pending_continuity = None;
            last_window = tracking_state
                .app_tracking_enabled
                .then_some(tracked_window);
            last_tracking_status = Some(tracking_state.tracking_status);
            clear_active_session_snapshot(&app);
            if let Some(reason) = stopped.change_reason {
                let _ = emit_tracking_data_changed(&app, reason, now_ms as u64);
            }
            drop(transition_guard);
            sleep(Duration::from_secs(1)).await;
            continue;
        }
        if !poll_outcome.is_successful_sample() {
            drop(transition_guard);
            sleep(Duration::from_secs(1)).await;
            continue;
        }
        if anonymous_cutoff.is_some() {
            last_window = None;
            pending_continuity = None;
        }

        if !tracking_state.app_tracking_enabled && tracking_state.tracking_status.is_tracking_active
        {
            if let Err(error) = anonymous_activity::record_sample(
                &app,
                data.as_ref(),
                &health_state,
                &mut timestamp_persist_state,
                now_ms,
                tracking_state.anonymous_web,
            )
            .await
            {
                log_tracker_error(format!("failed to record anonymous activity: {error}"));
            }
            pending_continuity = None;
            last_window = Some(tracked_window);
            last_tracking_status = Some(tracking_state.tracking_status);
            drop(transition_guard);
            sleep(Duration::from_secs(1)).await;
            continue;
        }

        let continuity_group_start_time =
            continuity::resolve_next_session_continuity_group_start_time(
                pending_continuity.as_ref(),
                &tracked_window,
                now_ms,
            );
        let new_pending_continuity = continuity::load_pending_continuity(
            data.as_ref(),
            last_window.as_ref(),
            last_tracking_status.as_ref(),
            &tracked_window,
            tracking_state.continuity_window_secs,
            now_ms,
        )
        .await;

        let did_change_active_window =
            tracker::has_meaningful_change(last_emitted_window.as_ref(), &window_info);

        let tracking_data_change_reason =
            match transition::apply_window_transition_with_title_policy(
                data.as_ref(),
                last_window.as_ref(),
                &tracked_window,
                now_ms,
                continuity_group_start_time,
                tracking_state.capture_window_title,
                active_session::start_session_for_transition,
            )
            .await
            {
                Ok(reason) => reason,
                Err(error) => {
                    log_tracker_error(format!("failed to apply window transition: {error}"));
                    clear_active_session_snapshot(&app);
                    drop(transition_guard);
                    sleep(Duration::from_secs(1)).await;
                    continue;
                }
            };
        record_committed_sample(
            data.as_ref(),
            &health_state,
            now_ms,
            poll_outcome.is_successful_sample(),
            &mut timestamp_persist_state,
        )
        .await;
        let did_change_tracking_data = tracking_data_change_reason.is_some();

        let did_change_tracking_status = !did_change_active_window
            && !did_change_tracking_data
            && should_emit_tracking_status_changed(
                last_tracking_status.as_ref(),
                &tracking_state.tracking_status,
            );

        pending_continuity = continuity::resolve_next_pending_continuity(
            pending_continuity,
            new_pending_continuity,
            continuity_group_start_time,
            &tracked_window,
            now_ms,
        );
        progress.enter(watchdog::TrackingStage::Snapshot);
        refresh_active_session_snapshot_if_changed(&app, data.as_ref(), did_change_tracking_data)
            .await;
        if did_change_active_window {
            if let Some(snapshot) = snapshot_state.snapshot() {
                let _ = app.emit("active-window-changed", &snapshot.window);
            }
            last_emitted_window = Some(window_info.clone());
        }
        last_window = Some(tracked_window);
        last_tracking_status = Some(tracking_state.tracking_status);
        emit_tracking_loop_change(
            &app,
            tracking_data_change_reason,
            did_change_tracking_status,
            now_ms,
        );
        drop(transition_guard);
        sleep(Duration::from_secs(1)).await;
    }
}

pub async fn handle_power_lifecycle_event<R: Runtime>(
    app: AppHandle<R>,
    data: &dyn TrackingDataStore,
) -> Result<(), String> {
    let snapshot_state = app.state::<TrackingRuntimeSnapshotState>();
    let _guard = snapshot_state.transition.lock().await;
    power_lifecycle::flush_pending_power_stop_and_publish(&app, data, &snapshot_state).await?;
    Ok(())
}

#[cfg(test)]
#[path = "runtime_mod_tests.rs"]
mod tests;
