import type { RefObject } from "react";
import type { HistoryTimelineViewport } from "../../../shared/lib/activityTimelineCompiler.ts";

export type HistoryTimelineViewportChangeReason = "pan" | "zoom";

export interface Params {
  selectedDate: Date;
  viewport: HistoryTimelineViewport;
  enabled: boolean;
  interactionRef: RefObject<HTMLDivElement | null>;
  onViewportChange: (
    viewport: HistoryTimelineViewport,
    reason: HistoryTimelineViewportChangeReason,
  ) => void;
}

export interface PendingViewportChange {
  viewport: HistoryTimelineViewport;
  reason: HistoryTimelineViewportChangeReason;
}

export interface DragSession {
  pointerId: number;
  startClientX: number;
  startViewport: HistoryTimelineViewport;
  trackWidthPx: number;
  element: HTMLDivElement;
  dragging: boolean;
}
