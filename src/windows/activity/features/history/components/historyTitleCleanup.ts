/**
 * One row of the timeline-details popover.
 *
 * Window-title samples and system-media samples both flatten into this shape so the
 * popover keeps a single list: `secondaryText` carries the artist/album line when the
 * row came from the media session, and stays empty for window titles.
 */
export type TimelineDetailTitle = {
  title: string;
  secondaryText?: string | null;
  startTime: number;
  endTime: number | null;
  duration?: number;
  isUntitled?: boolean;
};

/**
 * Strips the trailing app name that Windows appends to every window title
 * (`Video title - Google Chrome` → `Video title`).
 *
 * Only the exact ` - AppName` suffix is removed. Titles that legitimately end with an
 * en/em dash joined without spaces are left alone, because the separator Windows uses
 * is always a hyphen wrapped in spaces.
 */
export function cleanTimelineDetailTitle(
  sample: TimelineDetailTitle,
  appName: string,
): TimelineDetailTitle {
  if (sample.isUntitled) {
    return sample;
  }

  const normalizedTitle = sample.title.trim();
  const normalizedAppName = appName.trim();
  if (!normalizedTitle || !normalizedAppName) {
    return { ...sample, title: normalizedTitle };
  }

  const suffixPattern = new RegExp(
    `\\s+-\\s+${normalizedAppName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i",
  );
  return {
    ...sample,
    title: normalizedTitle.replace(suffixPattern, "").trim(),
  };
}

export function cleanTimelineDetailTitles(
  samples: TimelineDetailTitle[],
  appName: string,
): TimelineDetailTitle[] {
  return samples
    .map((sample) => cleanTimelineDetailTitle(sample, appName))
    .filter((sample) => sample.isUntitled || sample.title);
}
