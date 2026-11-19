use serde::{Deserialize, Serialize};

use super::contracts::{SustainedParticipationSignalSnapshot, SystemMediaPlaybackType};

pub const MEDIA_TITLE_MAX_CHARS: usize = 512;
pub const MEDIA_ARTIST_MAX_CHARS: usize = 256;

/// One probe reply: the participation signal and, when the platform exposes it,
/// what the playing session is actually showing.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct MediaProbePayload {
    pub signal: Option<SustainedParticipationSignalSnapshot>,
    pub media: Option<MediaPlaybackInfo>,
}

/// What the system media session reports as playing right now.
///
/// Deliberately separate from the participation signal: the signal answers "is the
/// user still engaged with this app", while this answers "what exactly is playing".
/// Only the system session exposes it, so it is always optional and never part of
/// the tracking decision itself.
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaPlaybackInfo {
    /// `SourceAppUserModelId` of the owning session, e.g. `Chrome` or a packaged app id.
    ///
    /// Desktop apps report a full executable path here; it is reduced to the file name
    /// so media rows can be matched (and deleted) by the same `exe_name` key the rest of
    /// the data layer uses. Packaged apps report an AUMID, which is kept verbatim.
    pub source_app_id: String,
    pub title: String,
    pub artist: Option<String>,
    pub playback_type: Option<SystemMediaPlaybackType>,
}

impl MediaPlaybackInfo {
    /// Returns `None` when the session has no usable title: an empty title would
    /// otherwise produce a segment that cannot be displayed or attributed.
    pub fn from_session(
        source_app_id: &str,
        title: &str,
        artist: Option<&str>,
        playback_type: Option<SystemMediaPlaybackType>,
    ) -> Option<Self> {
        let source_app_id = normalize_source_app_id(source_app_id);
        if source_app_id.is_empty() {
            return None;
        }
        Some(Self {
            source_app_id: source_app_id.to_string(),
            title: normalize_media_text(title, MEDIA_TITLE_MAX_CHARS)?,
            artist: artist.and_then(|value| normalize_media_text(value, MEDIA_ARTIST_MAX_CHARS)),
            playback_type,
        })
    }
}

fn normalize_source_app_id(value: &str) -> &str {
    let trimmed = value.trim();
    match trimmed.rsplit(['\\', '/']).next() {
        Some(file_name) if !file_name.is_empty() => file_name,
        _ => trimmed,
    }
}

fn normalize_media_text(value: &str, max_chars: usize) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(trimmed.chars().take(max_chars).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blank_titles_are_rejected_and_artist_is_optional() {
        assert!(MediaPlaybackInfo::from_session("Chrome", "   ", Some("artist"), None).is_none());
        assert!(MediaPlaybackInfo::from_session("  ", "标题", None, None).is_none());

        let info =
            MediaPlaybackInfo::from_session(" Chrome ", " 视频名 ", Some("   "), None).unwrap();
        assert_eq!(info.source_app_id, "Chrome");
        assert_eq!(info.title, "视频名");
        assert_eq!(info.artist, None);
    }

    #[test]
    fn desktop_executable_paths_are_reduced_to_the_process_name() {
        // Media rows are deleted together with the app, so the key has to line up with
        // `sessions.exe_name`; an absolute path would never match.
        let info = MediaPlaybackInfo::from_session(
            r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            "视频名",
            None,
            None,
        )
        .unwrap();
        assert_eq!(info.source_app_id, "chrome.exe");

        // Packaged apps report an AUMID with no path separator: keep it verbatim.
        let packaged =
            MediaPlaybackInfo::from_session("Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic", "歌", None, None)
                .unwrap();
        assert_eq!(
            packaged.source_app_id,
            "Microsoft.ZuneMusic_8wekyb3d8bbwe!Microsoft.ZuneMusic"
        );
    }

    #[test]
    fn overly_long_media_text_is_truncated_on_char_boundaries() {
        let long_title = "视".repeat(MEDIA_TITLE_MAX_CHARS + 10);
        let long_artist = "频".repeat(MEDIA_ARTIST_MAX_CHARS + 10);
        let info =
            MediaPlaybackInfo::from_session("Chrome", &long_title, Some(&long_artist), None)
                .unwrap();
        assert_eq!(info.title.chars().count(), MEDIA_TITLE_MAX_CHARS);
        assert_eq!(
            info.artist.as_deref().map(|value| value.chars().count()),
            Some(MEDIA_ARTIST_MAX_CHARS)
        );
    }
}
