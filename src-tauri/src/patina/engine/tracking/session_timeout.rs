use super::ports::{TrackingDataError, TrackingDataStore};
use super::transition;
use crate::patina::domain::tracking::{
    SustainedParticipationState, TrackingStatusSnapshot, WindowSessionIdentity,
    TRACKING_REASON_CONTINUITY_WINDOW_SEALED, TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED,
    TRACKING_REASON_TRACKING_PAUSED_SEALED,
};
use crate::patina::platform::windows::foreground as tracker;

pub(super) async fn seal_active_sessions_for_tracking_pause(
    data: &dyn TrackingDataStore,
    timestamp_ms: i64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if data.end_active_sessions(timestamp_ms).await? {
        return Ok(Some(TRACKING_REASON_TRACKING_PAUSED_SEALED));
    }

    Ok(None)
}

pub(super) async fn seal_active_sessions_for_continuity_timeout(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    now_ms: i64,
    continuity_window_secs: u64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if !has_exceeded_continuity_window(window, continuity_window_secs) {
        return Ok(None);
    }

    let resolved_end_time =
        resolve_continuity_window_end_time(now_ms, window.idle_time_ms, continuity_window_secs);

    if data.end_active_sessions(resolved_end_time).await? {
        return Ok(Some(TRACKING_REASON_CONTINUITY_WINDOW_SEALED));
    }

    Ok(None)
}

pub(super) async fn seal_active_sessions_for_passive_participation_timeout(
    data: &dyn TrackingDataStore,
    window: &tracker::WindowInfo,
    now_ms: i64,
    sustained_participation_secs: u64,
) -> Result<Option<&'static str>, TrackingDataError> {
    if !has_exceeded_sustained_participation_window(window, sustained_participation_secs) {
        return Ok(None);
    }

    let resolved_end_time = resolve_sustained_participation_end_time(
        now_ms,
        window.idle_time_ms,
        sustained_participation_secs,
    );

    if data.end_active_sessions(resolved_end_time).await? {
        return Ok(Some(TRACKING_REASON_PASSIVE_PARTICIPATION_SEALED));
    }

    Ok(None)
}

pub(super) fn should_suspend_active_tracking(
    previous_window: Option<&tracker::WindowInfo>,
    current_window: &tracker::WindowInfo,
    continuity_window_secs: u64,
    tracking_status: &TrackingStatusSnapshot,
) -> bool {
    if tracking_status.sustained_participation_active {
        return false;
    }

    if current_window.is_afk
        || !has_exceeded_continuity_window(current_window, continuity_window_secs)
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };
    let Some(current_identity) = transition::resolve_window_session_identity(Some(current_window))
    else {
        return false;
    };

    previous_identity.is_same_app(&current_identity)
}

pub(super) fn should_seal_sustained_participation(
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
    tracking_status: &TrackingStatusSnapshot,
) -> bool {
    if tracking_status.sustained_participation_state != SustainedParticipationState::Expired {
        return false;
    }

    if !previous_tracking_status
        .map(|status| status.sustained_participation_active)
        .unwrap_or(false)
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };
    let Some(current_identity) = WindowSessionIdentity::from_window_fields(
        &current_window.exe_name,
        current_window.process_id,
        &current_window.root_owner_hwnd,
        &current_window.hwnd,
        &current_window.window_class,
    ) else {
        return false;
    };

    previous_identity.is_same_app(&current_identity)
}

fn has_exceeded_continuity_window(
    window: &tracker::WindowInfo,
    continuity_window_secs: u64,
) -> bool {
    let continuity_window_ms = continuity_window_ms(continuity_window_secs);
    continuity_window_ms >= 0 && i64::from(window.idle_time_ms) > continuity_window_ms
}

fn has_exceeded_sustained_participation_window(
    window: &tracker::WindowInfo,
    sustained_participation_secs: u64,
) -> bool {
    let sustained_participation_window_ms =
        sustained_participation_window_ms(sustained_participation_secs);
    sustained_participation_window_ms >= 0
        && i64::from(window.idle_time_ms) > sustained_participation_window_ms
}

pub(super) fn resolve_continuity_window_end_time(
    now_ms: i64,
    idle_time_ms: u32,
    continuity_window_secs: u64,
) -> i64 {
    now_ms - i64::from(idle_time_ms) + continuity_window_ms(continuity_window_secs)
}

pub(super) fn resolve_sustained_participation_end_time(
    now_ms: i64,
    idle_time_ms: u32,
    sustained_participation_secs: u64,
) -> i64 {
    now_ms - i64::from(idle_time_ms)
        + sustained_participation_window_ms(sustained_participation_secs)
}

fn continuity_window_ms(continuity_window_secs: u64) -> i64 {
    continuity_window_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

fn sustained_participation_window_ms(sustained_participation_secs: u64) -> i64 {
    sustained_participation_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

#[cfg(test)]
#[path = "session_timeout_mod_tests.rs"]
mod tests;
