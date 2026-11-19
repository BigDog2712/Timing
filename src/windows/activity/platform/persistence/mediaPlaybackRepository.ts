import { invokeWithCommandError } from "./commandError.ts";

/** One segment of the system media timeline (`media_playback_samples`). */
export interface MediaPlaybackSample {
  sourceAppId: string;
  title: string;
  artist: string | null;
  playbackType: string | null;
  startTime: number;
  endTime: number | null;
}

/**
 * Reads what the system media session reported as playing inside a window.
 *
 * Returns `[]` instead of throwing when the command is unavailable (older build,
 * headless test host): media details are additive to the popover and must never
 * take the whole activity view down.
 */
export async function getMediaPlaybackSamples(
  startMs: number,
  endMs: number,
): Promise<MediaPlaybackSample[]> {
  try {
    return await invokeWithCommandError<MediaPlaybackSample[]>(
      "cmd_get_media_playback_samples",
      { startMs, endMs },
    );
  } catch (error) {
    console.warn("Failed to load media playback samples:", error);
    return [];
  }
}
