use crate::commands::activity::{error::CommandErrorDto, window_guard::require_main_window};
use crate::services::activity::data::repositories::media_playback;
use crate::services::activity::data::sqlite_pool::wait_for_sqlite_pool;
use tauri::{AppHandle, Runtime, WebviewWindow};

/// Returns the media timeline that overlaps `[start_ms, end_ms)`.
///
/// Ordered oldest first so callers can lay it over a session timeline without
/// re-sorting; overlapping segments are already impossible because the writer
/// keeps a single open row.
#[tauri::command]
pub async fn cmd_get_media_playback_samples<R: Runtime>(
    start_ms: i64,
    end_ms: i64,
    app: AppHandle<R>,
    window: WebviewWindow<R>,
) -> Result<Vec<media_playback::MediaPlaybackSample>, CommandErrorDto> {
    require_main_window(&window)?;
    let pool = wait_for_sqlite_pool(&app)
        .await
        .map_err(|error| CommandErrorDto::new("SQLITE_UNAVAILABLE", error, true))?;
    media_playback::fetch_range(&pool, start_ms, end_ms)
        .await
        .map_err(|error| CommandErrorDto::new("DB_ERROR", error, true))
}
