use super::ports::TrackingDataStore;
use super::transition;
use crate::models::insight::tracking::TrackingStatusSnapshot;
use crate::infra::insight::windows::foreground as tracker;

#[derive(Clone, Debug)]
pub(crate) struct PendingContinuity {
    pub(crate) app_key: String,
    pub(crate) continuity_group_start_time: i64,
    pub(crate) expires_at_ms: i64,
}

pub(crate) async fn load_pending_continuity(
    data: &dyn TrackingDataStore,
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
    continuity_window_secs: u64,
    now_ms: i64,
) -> Option<PendingContinuity> {
    if !should_open_pending_continuity(previous_window, previous_tracking_status, current_window) {
        return None;
    }

    let previous_identity = transition::resolve_window_session_identity(previous_window)?;
    let active_session = data.load_active_session().await.ok().flatten()?;

    Some(PendingContinuity {
        app_key: previous_identity.app_key,
        continuity_group_start_time: active_session.continuity_group_start_time,
        expires_at_ms: now_ms + continuity_window_ms(continuity_window_secs),
    })
}

pub(crate) fn resolve_next_session_continuity_group_start_time(
    pending_continuity: Option<&PendingContinuity>,
    window: &tracker::WindowInfo,
    now_ms: i64,
) -> i64 {
    let Some(pending_continuity) = pending_continuity else {
        return now_ms;
    };

    if pending_continuity.expires_at_ms < now_ms {
        return now_ms;
    }

    let Some(current_identity) = transition::resolve_window_session_identity(Some(window)) else {
        return now_ms;
    };

    if current_identity.app_key != pending_continuity.app_key {
        return now_ms;
    }

    pending_continuity.continuity_group_start_time
}

pub(crate) fn resolve_next_pending_continuity(
    existing_pending_continuity: Option<PendingContinuity>,
    new_pending_continuity: Option<PendingContinuity>,
    continuity_group_start_time: i64,
    current_window: &tracker::WindowInfo,
    now_ms: i64,
) -> Option<PendingContinuity> {
    if let Some(new_pending_continuity) = new_pending_continuity {
        return Some(new_pending_continuity);
    }

    let existing_pending_continuity = existing_pending_continuity?;
    if existing_pending_continuity.expires_at_ms < now_ms {
        return None;
    }

    let Some(current_identity) = transition::resolve_window_session_identity(Some(current_window))
    else {
        return Some(existing_pending_continuity);
    };

    if current_identity.app_key == existing_pending_continuity.app_key
        && continuity_group_start_time == existing_pending_continuity.continuity_group_start_time
    {
        return None;
    }

    Some(existing_pending_continuity)
}

fn should_open_pending_continuity(
    previous_window: Option<&tracker::WindowInfo>,
    previous_tracking_status: Option<&TrackingStatusSnapshot>,
    current_window: &tracker::WindowInfo,
) -> bool {
    if !previous_tracking_status
        .map(|status| status.is_tracking_active)
        .unwrap_or(false)
        || current_window.is_afk
    {
        return false;
    }

    let Some(previous_identity) = transition::resolve_window_session_identity(previous_window)
    else {
        return false;
    };

    match transition::resolve_window_session_identity(Some(current_window)) {
        Some(current_identity) => !previous_identity.is_same_app(&current_identity),
        None => true,
    }
}

fn continuity_window_ms(continuity_window_secs: u64) -> i64 {
    continuity_window_secs
        .saturating_mul(1000)
        .min(i64::MAX as u64) as i64
}

#[cfg(test)]
#[path = "continuity_mod_tests.rs"]
mod tests;
