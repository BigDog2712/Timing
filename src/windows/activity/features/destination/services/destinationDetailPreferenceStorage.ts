import { DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS } from "./destinationDetailTimelineViewport.ts";
import {
  readActivityKey,
  writeActivityKey,
} from "../../../../shared/activityStorageKeys";

/* [T04-4] 键名从注册表取（老键字面量只住 activityStorageKeys.ts）；
   读写走出口（先过迁移闸）。当前键 + 更早键名（只读回落）的两级读链保持不变。 */

const DEFAULT_DETAIL_MIN_SECS = 60;
export const DETAIL_MIN_SECS_RANGE = {
  min: 0,
  max: 600,
} as const;

function parseZoomHours(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const zoomHours = Number(value);
  return Number.isFinite(zoomHours) && zoomHours >= 1 && zoomHours <= 24
    ? zoomHours
    : null;
}

function parseMinSecs(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const seconds = Number(value);
  return Number.isInteger(seconds)
    && seconds % 60 === 0
    && seconds >= DETAIL_MIN_SECS_RANGE.min
    && seconds <= DETAIL_MIN_SECS_RANGE.max
    ? seconds
    : null;
}

export function clampDetailMinSecs(value: number) {
  if (!Number.isFinite(value)) {
    return DEFAULT_DETAIL_MIN_SECS;
  }
  return Math.min(
    DETAIL_MIN_SECS_RANGE.max,
    Math.max(
      DETAIL_MIN_SECS_RANGE.min,
      Math.round(value / 60) * 60,
    ),
  );
}

export function readDestinationDetailTimelineZoomHours(): number {
  try {
    return parseZoomHours(readActivityKey("destinationDetailZoomHours"))
      ?? parseZoomHours(readActivityKey("destinationDetailZoomHoursLegacy"))
      ?? DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS;
  } catch {
    return DEFAULT_DESTINATION_DETAIL_ZOOM_HOURS;
  }
}

export function rememberDestinationDetailTimelineZoomHours(zoomHours: number) {
  if (!Number.isFinite(zoomHours) || zoomHours < 1 || zoomHours > 24) {
    return;
  }

  try {
    writeActivityKey(
      "destinationDetailZoomHours",
      String(Number(zoomHours.toFixed(4))),
    );
  } catch {
    // Detail timeline preferences are best-effort; never block the interaction.
  }
}

export function readDetailMinSecs(): number {
  try {
    return parseMinSecs(readActivityKey("destinationDetailMinSecs"))
      ?? parseMinSecs(readActivityKey("destinationDetailMinSecsLegacy"))
      ?? DEFAULT_DETAIL_MIN_SECS;
  } catch {
    return DEFAULT_DETAIL_MIN_SECS;
  }
}

export function saveDetailMinSecs(seconds: number) {
  const normalizedSeconds = parseMinSecs(String(seconds));
  if (normalizedSeconds === null) return;

  try {
    writeActivityKey("destinationDetailMinSecs", String(normalizedSeconds));
  } catch {
    // Detail timeline preferences are best-effort; never block the interaction.
  }
}
