//! 媒体时间线的出口：sink 类型、进程内唯一槽位，以及「这一轮要不要写进去」的判据。
//!
//! 单独成文件的理由有两条：`media.rs` 卡在体积棘轮上；更重要的是，这段判据不碰 WinRT
//! 也不碰 tokio，是整条链路里唯一能被单元测试直接盯住的三态逻辑。

use crate::models::activity::tracking::{MediaPlaybackInfo, MediaProbePayload};
use std::sync::{Arc, OnceLock};

/// Receives every reconciled media sample so storage can keep a timeline.
///
/// Injected once at startup on purpose: the probe stays storage-agnostic, and a
/// missing sink (tests, headless runs) simply means no timeline is written.
pub type MediaSampleSink = Arc<dyn Fn(Option<&MediaPlaybackInfo>, i64) + Send + Sync>;

pub(super) static MEDIA_SAMPLE_SINK: OnceLock<MediaSampleSink> = OnceLock::new();

/// Decides whether a reconcile pass may touch the persisted media timeline.
///
/// The outer `Option` answers "call the sink at all"; the inner one answers "was there
/// anything playing". A failed probe must not reach the sink: treating a WinRT timeout as
/// "playback stopped" would cut one continuous playback into a row per failed poll, while
/// `Ok(None)` really does mean the segment ended.
pub(super) fn sink_sample(
    probe_result: &Result<Option<MediaProbePayload>, ()>,
) -> Option<Option<&MediaPlaybackInfo>> {
    match probe_result {
        Ok(payload) => Some(payload.as_ref().and_then(|payload| payload.media.as_ref())),
        Err(()) => None,
    }
}
