use crate::models::activity::tracking::{MediaPlaybackInfo, SystemMediaPlaybackType};
use sqlx::{Pool, Row, Sqlite};

/// One row of the media timeline, already normalised for display.
#[derive(Clone, Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaPlaybackSample {
    pub source_app_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub playback_type: Option<String>,
    pub start_time: i64,
    pub end_time: Option<i64>,
}

struct ActiveSample {
    id: i64,
    source_app_id: String,
    title: String,
    artist: Option<String>,
}

/// Records what is playing at `now_ms`, splitting the timeline only when the
/// identity actually changes.
///
/// A `None` media means "nothing is playing": the open segment is closed and no new
/// one is started, so paused playback leaves a tidy boundary instead of a gap that
/// later gets misread as playback.
pub async fn record_sample(
    pool: &Pool<Sqlite>,
    source_app_id: &str,
    media: Option<&MediaPlaybackInfo>,
    playback_type: Option<SystemMediaPlaybackType>,
    now_ms: i64,
) -> Result<bool, String> {
    let active = load_active_sample(pool).await?;

    let Some(media) = media else {
        return close_active_sample(pool, active.as_ref(), now_ms).await;
    };

    if let Some(active) = active.as_ref() {
        if active.source_app_id == source_app_id
            && active.title == media.title
            && active.artist.as_deref() == media.artist.as_deref()
        {
            return Ok(false);
        }
    }

    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to open media sample transaction: {error}"))?;

    if let Some(active) = active.as_ref() {
        close_in_tx(&mut tx, active.id, now_ms).await?;
    }

    sqlx::query(
        "INSERT INTO media_playback_samples
             (source_app_id, title, artist, playback_type, start_time)
         VALUES (?, ?, ?, ?, ?)",
    )
    .bind(source_app_id)
    .bind(media.title.as_str())
    .bind(media.artist.as_deref())
    .bind(playback_type_label(playback_type))
    .bind(now_ms)
    .execute(&mut *tx)
    .await
    .map_err(|error| format!("failed to record media sample: {error}"))?;

    tx.commit()
        .await
        .map_err(|error| format!("failed to commit media sample: {error}"))?;
    Ok(true)
}

/// Reads the timeline for a window, ordered oldest first.
pub async fn fetch_range(
    pool: &Pool<Sqlite>,
    start_ms: i64,
    end_ms: i64,
) -> Result<Vec<MediaPlaybackSample>, String> {
    let rows = sqlx::query(
        "SELECT source_app_id, title, artist, playback_type, start_time, end_time
         FROM media_playback_samples
         WHERE start_time < ?
           AND (end_time IS NULL OR end_time > ?)
         ORDER BY start_time ASC, id ASC",
    )
    .bind(end_ms)
    .bind(start_ms)
    .fetch_all(pool)
    .await
    .map_err(|error| format!("failed to read media samples: {error}"))?;

    Ok(rows
        .into_iter()
        .map(|row| MediaPlaybackSample {
            source_app_id: row.get("source_app_id"),
            title: row.get("title"),
            artist: row.get("artist"),
            playback_type: row.get("playback_type"),
            start_time: row.get("start_time"),
            end_time: row.get("end_time"),
        })
        .collect())
}

/// Drops every sample for the given apps (used when an app is excluded, or when its
/// history is deleted).
///
/// Matching is case-insensitive: `sessions.exe_name` keeps the on-disk casing while the
/// media session reports whatever the player registered, and a missed row here means a
/// deleted app keeps a play history the user asked to remove.
pub async fn delete_by_app_ids(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    app_ids: &[String],
) -> Result<u64, sqlx::Error> {
    if app_ids.is_empty() {
        return Ok(0);
    }
    let payload = serde_json::to_string(app_ids).map_err(|error| sqlx::Error::Protocol(error.to_string()))?;
    let result = sqlx::query(
        "DELETE FROM media_playback_samples
         WHERE LOWER(source_app_id) IN (SELECT LOWER(value) FROM json_each(?))",
    )
    .bind(payload)
    .execute(&mut **tx)
    .await?;
    Ok(result.rows_affected())
}

async fn load_active_sample(pool: &Pool<Sqlite>) -> Result<Option<ActiveSample>, String> {
    let row = sqlx::query(
        "SELECT id, source_app_id, title, artist
         FROM media_playback_samples
         WHERE end_time IS NULL
         ORDER BY start_time DESC, id DESC
         LIMIT 1",
    )
    .fetch_optional(pool)
    .await
    .map_err(|error| format!("failed to read active media sample: {error}"))?;

    Ok(row.map(|row| ActiveSample {
        id: row.get("id"),
        source_app_id: row.get("source_app_id"),
        title: row.get("title"),
        artist: row.get("artist"),
    }))
}

async fn close_active_sample(
    pool: &Pool<Sqlite>,
    active: Option<&ActiveSample>,
    now_ms: i64,
) -> Result<bool, String> {
    let Some(active) = active else {
        return Ok(false);
    };
    let mut tx = pool
        .begin()
        .await
        .map_err(|error| format!("failed to open media sample transaction: {error}"))?;
    let changed = close_in_tx(&mut tx, active.id, now_ms).await?;
    tx.commit()
        .await
        .map_err(|error| format!("failed to commit media sample: {error}"))?;
    Ok(changed > 0)
}

async fn close_in_tx(
    tx: &mut sqlx::Transaction<'_, Sqlite>,
    id: i64,
    now_ms: i64,
) -> Result<u64, String> {
    let result = sqlx::query(
        "UPDATE media_playback_samples
         SET end_time = CASE WHEN ? < start_time THEN start_time ELSE ? END
         WHERE id = ? AND end_time IS NULL",
    )
    .bind(now_ms)
    .bind(now_ms)
    .bind(id)
    .execute(&mut **tx)
    .await
    .map_err(|error| format!("failed to close media sample: {error}"))?;
    Ok(result.rows_affected())
}

fn playback_type_label(value: Option<SystemMediaPlaybackType>) -> Option<&'static str> {
    match value? {
        SystemMediaPlaybackType::Audio => Some("audio"),
        SystemMediaPlaybackType::Video => Some("video"),
        SystemMediaPlaybackType::Image => Some("image"),
        SystemMediaPlaybackType::Unknown => Some("unknown"),
    }
}

#[cfg(test)]
#[path = "media_playback_mod_tests.rs"]
mod tests;
