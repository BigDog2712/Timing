use crate::infra::activity::windows::media::MediaSampleSink;
use crate::models::activity::tracking::MediaPlaybackInfo;
use crate::services::activity::data::repositories::media_playback;
use crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool;
use std::sync::Arc;
use tauri::{AppHandle, Runtime};

/// Builds the sink that turns probe samples into a persisted media timeline.
///
/// The probe runs on a 10s cadence and must never wait for SQLite: a slow disk or a
/// pool reopen would otherwise stall the media loop and, with it, participation
/// detection. Each sample therefore hands off to a detached task that drops the
/// sample on failure rather than retrying — a missing timeline row is acceptable,
/// a stalled tracker is not.
pub fn build_sink<R: Runtime>(app: AppHandle<R>) -> MediaSampleSink {
    Arc::new(move |media: Option<&MediaPlaybackInfo>, now_ms: i64| {
        let app = app.clone();
        let media = media.cloned();
        tauri::async_runtime::spawn(async move {
            if let Err(error) = persist(&app, media.as_ref(), now_ms).await {
                crate::log_error!("failed to persist media playback sample: {error}");
            }
        });
    })
}

async fn persist<R: Runtime>(
    app: &AppHandle<R>,
    media: Option<&MediaPlaybackInfo>,
    now_ms: i64,
) -> Result<(), String> {
    let pool = wait_for_sqlite_pool(app).await?;
    let source_app_id = media
        .map(|media| media.source_app_id.as_str())
        .unwrap_or_default();
    let playback_type = media.and_then(|media| media.playback_type);

    media_playback::record_sample(&pool, source_app_id, media, playback_type, now_ms)
        .await
        .map(|_| ())
}
