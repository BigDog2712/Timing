import {
  DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS,
  MAX_HISTORY_TIMELINE_ZOOM_HOURS,
} from "../../../shared/lib/activityTimelineCompiler.ts";
import {
  readActivityKey,
  writeActivityKey,
} from "../../../../shared/activityStorageKeys";

export type DayDistributionMode = "app" | "category" | "web";

function isDayDistributionMode(value: string | null): value is DayDistributionMode {
  return value === "app" || value === "category" || value === "web";
}

function parseHistoryTimelineZoomHours(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const numericValue = Number(value);
  return Number.isFinite(numericValue) && numericValue >= 1 && numericValue <= MAX_HISTORY_TIMELINE_ZOOM_HOURS
    ? numericValue
    : null;
}

export function readHistoryTimelineZoomHours(): number {
  try {
    return parseHistoryTimelineZoomHours(readActivityKey("historyTimelineZoomHours"))
      ?? DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS;
  } catch {
    return DEFAULT_HISTORY_TIMELINE_ZOOM_HOURS;
  }
}

export function rememberHistoryTimelineZoomHours(zoomHours: number) {
  if (!Number.isFinite(zoomHours) || zoomHours < 1 || zoomHours > MAX_HISTORY_TIMELINE_ZOOM_HOURS) return;

  try {
    writeActivityKey("historyTimelineZoomHours", String(Number(zoomHours.toFixed(4))));
  } catch {
    // History layout preferences are best-effort; never block the interaction.
  }
}

export function readHistoryDayDistributionMode(): DayDistributionMode {
  try {
    const value = readActivityKey("historyDayDistributionMode");
    return isDayDistributionMode(value) ? value : "app";
  } catch {
    return "app";
  }
}

export function rememberHistoryDayDistributionMode(mode: DayDistributionMode) {
  try {
    writeActivityKey("historyDayDistributionMode", mode);
  } catch {
    // History layout preferences are best-effort; never block the interaction.
  }
}

export function resolveEffectiveDayDistributionMode(
  mode: DayDistributionMode,
  webActivityEnabled: boolean,
): DayDistributionMode {
  return !webActivityEnabled && mode === "web" ? "app" : mode;
}
