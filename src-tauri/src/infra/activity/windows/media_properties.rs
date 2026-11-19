use crate::models::activity::tracking::{MediaPlaybackInfo, SystemMediaPlaybackType};
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager, GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};
use windows::Media::MediaPlaybackType;
use windows::Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED};

/// Keeps one Media Foundation apartment alive for the lifetime of a probe.
///
/// WinRT must be initialised on the thread that calls into the media manager, and
/// the apartment has to outlive every object created inside it, so callers hold
/// this guard alongside the manager and rely on drop order.
pub(super) struct MediaApartment(std::marker::PhantomData<std::rc::Rc<()>>);

impl MediaApartment {
    pub(super) fn initialize() -> Result<Self, String> {
        unsafe { RoInitialize(RO_INIT_MULTITHREADED) }
            .map_err(|error| format!("initializing media WinRT apartment failed: {error}"))?;
        Ok(Self(std::marker::PhantomData))
    }
}

impl Drop for MediaApartment {
    fn drop(&mut self) {
        unsafe { RoUninitialize() };
    }
}

pub(super) fn map_playback_type(value: MediaPlaybackType) -> SystemMediaPlaybackType {
    if value == MediaPlaybackType::Video {
        return SystemMediaPlaybackType::Video;
    }
    if value == MediaPlaybackType::Music {
        return SystemMediaPlaybackType::Audio;
    }
    if value == MediaPlaybackType::Image {
        return SystemMediaPlaybackType::Image;
    }
    SystemMediaPlaybackType::Unknown
}

/// Reads the title/artist of whichever session is actually playing.
///
/// This walks the sessions separately from the participation probe on purpose: the
/// participation probe answers "is something playing", while this answers "what is
/// playing". A session that is merely paused still reports properties, so only a
/// `Playing` session is allowed to win.
pub(super) fn read_active_media(
    manager: &GlobalSystemMediaTransportControlsSessionManager,
) -> Option<MediaPlaybackInfo> {
    let sessions = manager.GetSessions().ok()?;
    let count = sessions.Size().ok()?;

    for index in 0..count {
        let session = sessions.GetAt(index).ok()?;
        if !is_playing(&session) {
            continue;
        }
        if let Some(info) = read_session_media(&session) {
            return Some(info);
        }
    }

    None
}

fn is_playing(session: &GlobalSystemMediaTransportControlsSession) -> bool {
    session
        .GetPlaybackInfo()
        .and_then(|info| info.PlaybackStatus())
        .map(|status| status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
        .unwrap_or(false)
}

fn read_session_media(
    session: &GlobalSystemMediaTransportControlsSession,
) -> Option<MediaPlaybackInfo> {
    let source_app_id = session.SourceAppUserModelId().ok()?.to_string_lossy();
    let playback_type = session
        .GetPlaybackInfo()
        .ok()
        .and_then(|info| info.PlaybackType().ok())
        .and_then(|value| value.Value().ok())
        .map(map_playback_type);
    let properties = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
    let title = properties.Title().ok()?.to_string_lossy();
    let artist = properties.Artist().ok().map(|value| value.to_string_lossy());
    MediaPlaybackInfo::from_session(&source_app_id, &title, artist.as_deref(), playback_type)
}
