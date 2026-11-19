import { getMediaPlaybackSamples } from "../../../platform/persistence/mediaPlaybackRepository.ts";
import type { MediaPlaybackSample } from "../../../platform/persistence/mediaPlaybackRepository.ts";
import type { TimelineDetailTitle } from "./historyTitleCleanup.ts";

type MediaLoader = (startMs: number, endMs: number) => Promise<MediaPlaybackSample[]>;

/**
 * Merges the system media timeline into the window-title rows of the popover.
 *
 * The two sources overlap heavily in practice: when Chrome plays a video the window
 * title is usually the same string plus a browser suffix. Media rows whose title is
 * already contained in a window-title row are therefore dropped, so a video does not
 * show up twice with and without `- Google Chrome`. The remaining rows keep the
 * played title as `title` and the artist as `secondaryText`, which is exactly what a
 * window title cannot tell us.
 */
export function mergeMediaDetailRows(
  titleSamples: TimelineDetailTitle[],
  mediaSamples: MediaPlaybackSample[],
): TimelineDetailTitle[] {
  const knownTitles = titleSamples
    .map((sample) => sample.title.trim().toLocaleLowerCase())
    .filter(Boolean);

  const mediaRows = mediaSamples
    .filter((sample) => sample.title.trim().length > 0)
    .filter((sample) => {
      const candidate = sample.title.trim().toLocaleLowerCase();
      return !knownTitles.some((known) => known.includes(candidate));
    })
    .map<TimelineDetailTitle>((sample) => ({
      title: sample.title,
      secondaryText: sample.artist,
      startTime: sample.startTime,
      endTime: sample.endTime,
    }));

  if (mediaRows.length === 0) {
    return titleSamples;
  }

  return [...titleSamples, ...mediaRows].sort((left, right) => left.startTime - right.startTime);
}

/** Computes the window covered by a popover so one query can serve the whole list. */
export function resolveDetailWindow(
  titleSamples: TimelineDetailTitle[],
  nowMs: number,
): { startMs: number; endMs: number } | null {
  if (titleSamples.length === 0) {
    return null;
  }
  const starts = titleSamples.map((sample) => sample.startTime);
  const ends = titleSamples.map((sample) => sample.endTime ?? nowMs);
  return { startMs: Math.min(...starts), endMs: Math.max(...ends) };
}

/**
 * Loads media rows for the popped session and hands the merged list back.
 *
 * The popover renders immediately from window titles and is enriched a moment later,
 * so opening it never waits on the database. `apply` is only called when something
 * actually changed, and the caller is responsible for ignoring stale sessions.
 */
export async function enrichTimelineDetailsWithMedia(
  titleSamples: TimelineDetailTitle[],
  nowMs: number,
  apply: (rows: TimelineDetailTitle[]) => void,
  load: MediaLoader = getMediaPlaybackSamples,
): Promise<void> {
  const range = resolveDetailWindow(titleSamples, nowMs);
  if (!range) {
    return;
  }

  const mediaSamples = await load(range.startMs, range.endMs);
  if (mediaSamples.length === 0) {
    return;
  }

  const merged = mergeMediaDetailRows(titleSamples, mediaSamples);
  if (merged.length === titleSamples.length) {
    return;
  }

  apply(merged);
}
