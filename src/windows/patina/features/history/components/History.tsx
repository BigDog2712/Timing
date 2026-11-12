import { useLocale, type Locale, type UiText } from "../../../shared/i18n/index.ts";
import { useState, useEffect, useCallback, useLayoutEffect, useMemo, useRef, } from "react";
import type { CSSProperties, ReactNode } from "react";
import { X } from "lucide-react";

import { formatTime } from "../services/historyFormatting";
import { useIconThemeColors, useIconThemeColorSnapshot } from "../../../shared/hooks/useIconThemeColors";
import { useRequestedAppIcons } from "../../../shared/hooks/useRequestedAppIcons.ts";
import {
  buildHistoryReadModel,
  type HistorySnapshot,
  type HistorySnapshotLoadOptions,
} from "../services/historyReadModel";
import type { TrackerHealthSnapshot } from "../../../shared/types/tracking";
import HistoryHorizontalTimeline from "./HistoryHorizontalTimeline.tsx";
import {
  HistoryMinDurationControl,
  HistoryTimelineActionButtons,
  HistoryTimelineModeButton,
} from "./HistoryTimelineActions.tsx";
import QuietDialog from "../../../shared/components/QuietDialog";
import QuietSegmentedFilter, { type QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { HourlyActivityChartMode } from "../../../shared/settings/appSettings.ts";
import {
  getHistoryTimelineZoomDurationMs,
  normalizeHistoryTimelineViewport,
  normalizeHistoryTimelineViewportAroundFocus,
  snapHistoryTimelineFocusToNearestHalfHour,
  type HistoryTimelineViewport,
} from "../../../shared/lib/activityTimelineCompiler.ts";
import {
  useHistoryTimelineViewportInteraction,
  type HistoryTimelineViewportChangeReason,
} from "../hooks/useHistoryTimelineViewportInteraction.ts";
import { useHistorySnapshotRuntime } from "../hooks/useHistorySnapshotRuntime.ts";
import {
  readHistoryTimelineZoomHours,
  rememberHistoryTimelineZoomHours,
} from "../services/historyLayoutPreferenceStorage.ts";
import {
  buildWebDomainIconMap,
  buildWebTimelineItems,
} from "../../../shared/lib/webActivityViewModel.ts";
import { useHistoryTimelineMode } from "../hooks/useHistoryTimelineMode.ts";
import {
  hasMeaningfulHistoryContent,
  shouldHideTimelineContent,
  useHistoryTimelineViews,
} from "../hooks/useHistoryTimelineViews.ts";
import { loadHistoryIconsForExecutables } from "../services/historyIconService.ts";
import {
  addLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../../../shared/lib/localDate.ts";
import { resolveTimelineFocusAtReferenceLocalTime } from "../../../shared/lib/timelineAxis.ts";
import HistoryTimelineDetailsPopover, {
  resolveTimelineDetailsPopoverPosition,
  type HistoryTimelineDetailsPopoverState,
  type TimelineDetailTitle,
} from "./HistoryTimelineDetailsPopover.tsx";
import {
  HistoryTimelineList,
  HistoryWebTimelineList,
} from "./HistoryTimelineLists.tsx";
import HistoryHourlyActivityPanel from "./HistoryHourlyActivityPanel.tsx";
import HistoryDateHeader from "./HistoryDateHeader.tsx";
import HistoryTimelineDialogDateControls from "./HistoryTimelineDialogDateControls.tsx";
import HistoryTimelineZoomDialog from "./HistoryTimelineZoomDialog.tsx";
import { useHistoryDestinationDetailEntry } from "../hooks/useHistoryDestinationDetailEntry.tsx";
import HistoryTimingLane from "./HistoryTimingLane.tsx";
import HistoryActivityActionDialog, { type HistoryActivityActionTarget } from "./HistoryActivityActionDialog.tsx";
import HistoryRangeHeader from "./HistoryRangeHeader.tsx";
import HistoryRangeModeBar from "./HistoryRangeModeBar.tsx";
import HistoryRangeView from "./HistoryRangeView.tsx";
import { useHistoryRangeData } from "../hooks/useHistoryRangeData.ts";
import { HISTORY_RANGE_COPY, type HistoryRangeCopy } from "../rangeCopy.ts";
import type {
  HistoryRangeCustomBounds,
  HistoryRangeMode,
} from "../services/historyRange.ts";

interface Props {
  onInitialContentReady?: () => void;
  uiText: UiText;
  locale: Locale;
  icons: Record<string, string>;
  refreshKey?: number;
  refreshIntervalSecs: number;
  mergeThresholdSecs: number;
  minSessionSecs: number;
  onMinSessionSecsChange?: (value: number) => void;
  trackerHealth: TrackerHealthSnapshot;
  getHistorySeedSnapshot: (date: Date) => HistorySnapshot | null;
  loadHistorySnapshot: (
    date: Date,
    rollingDayCount?: number,
    options?: HistorySnapshotLoadOptions,
  ) => Promise<HistorySnapshot>;
  mappingVersion?: number;
  selectedDateRequest?: {
    dateKey: string;
    requestId: number;
    focusApp?: string | null;
  } | null;
  hourlyActivityChartMode: HourlyActivityChartMode;
  onHourlyActivityChartModeChange: (mode: HourlyActivityChartMode) => void;
  refreshEnabled?: boolean;
  webActivityEnabled?: boolean;
  onOverridesChanged: () => void;
  onQuickActionError: (message: string) => void;
}

const TIMELINE_MIN_SESSION_MINUTES_RANGE = { min: 0, max: 10 } as const;
const clampMinute = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const startOfDay = startOfLocalDay;
const startOfMonth = startOfLocalMonth;
const formatTimelineWindowBoundary = (timeMs: number, dayEndMs: number, locale: Locale) => (
  timeMs === dayEndMs ? "24:00" : formatTime(timeMs, locale)
);
const getHourlyActivityModeActionLabel = (mode: HourlyActivityChartMode, text: UiText["history"]) => (
  mode === "category"
    ? text.showTotalHourlyActivity
    : text.showHourlyActivityByCategory
);
type TimelineDialogMode = "app" | "web";
function cleanTimelineDetailTitle(sample: TimelineDetailTitle, appName: string): TimelineDetailTitle {
  if (sample.isUntitled) {
    return sample;
  }

  const normalizedTitle = sample.title.trim();
  const normalizedAppName = appName.trim();
  if (!normalizedTitle || !normalizedAppName) {
    return { ...sample, title: normalizedTitle };
  }

  const suffixPattern = new RegExp(`\\s+-\\s+${normalizedAppName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i");
  return {
    ...sample,
    title: normalizedTitle.replace(suffixPattern, "").trim(),
  };
}

function cleanTimelineDetailTitles(samples: TimelineDetailTitle[], appName: string) {
  return samples
    .map((sample) => cleanTimelineDetailTitle(sample, appName))
    .filter((sample) => sample.isUntitled || sample.title);
}

const MILLISECONDS_PER_HOUR = 60 * 60_000;

/**
 * 历史页外壳：只决定「看单日」还是「看一段」，两套主体各自完整。
 *
 * 为什么外壳不把两套渲染合在一个组件里：单日那套有 60+ 个 hook（快照、时间轴视口、
 * 泳道、弹窗…），区间那套一个都不需要。合在一起要么违反 hook 顺序（提前 return），
 * 要么在区间模式下白跑一整套日快照与轮询。拆成两个子组件后，
 * 切档 = 挂载/卸载，各自负责自己的取数。
 *
 * `History.tsx` 同时冻结在 size-allowlist 的 1147 行，所以外壳与单日主体**留在同一文件**
 * （改名会造出一条新的超限文件 = 变相新增豁免，门禁不允许）。
 */
export default function History(props: Props) {
  const rangeCopy = HISTORY_RANGE_COPY[useLocale()];
  const [rangeMode, setRangeMode] = useState<HistoryRangeMode>("day");
  const [customBounds, setCustomBounds] = useState<HistoryRangeCustomBounds | null>(null);
  const [focusDateKey, setFocusDateKey] = useState<string | null>(null);
  const rangeData = useHistoryRangeData({
    mode: rangeMode,
    customBounds,
    refreshKey: props.refreshKey ?? 0,
    labels: rangeCopy,
    unnamedItemLabel: rangeCopy.unnamedItem,
  });
  const rangeBar = (
    <HistoryRangeModeBar
      mode={rangeMode}
      customBounds={customBounds}
      copy={rangeCopy}
      uiText={props.uiText}
      onModeChange={setRangeMode}
      onCustomBoundsChange={setCustomBounds}
    />
  );

  if (rangeMode === "day") {
    return (
      <HistoryDayView
        key={focusDateKey ?? "day"}
        {...props}
        initialDateKey={focusDateKey}
        rangeBar={rangeBar}
        rangeCopy={rangeCopy}
      />
    );
  }

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-4 md:gap-5 h-full overflow-hidden"
      data-history-range-mode={rangeMode}
    >
      <HistoryRangeHeader
        title={props.uiText.history.title}
        rangeLabel={rangeData.resolvedRange?.label ?? ""}
        rangeBar={rangeBar}
      />
      <HistoryRangeView
        copy={rangeCopy}
        uiText={props.uiText}
        locale={props.locale}
        data={rangeData}
        onOpenDay={(dateKey) => {
          setFocusDateKey(dateKey);
          setRangeMode("day");
        }}
      />
    </div>
  );
}

interface HistoryDayViewProps extends Props {
  /** 区间视图点某一天时带进来的落点（`null` = 按 `selectedDateRequest` 或今天） */
  initialDateKey: string | null;
  rangeBar: ReactNode;
  /** 区间视图的新文案表（单日与区间共用四格摘要 / 排行 / 明细） */
  rangeCopy: HistoryRangeCopy;
}

function HistoryDayView({
  uiText: UI_TEXT,
  locale,
  icons,
  refreshKey = 0,
  refreshIntervalSecs,
  mergeThresholdSecs,
  minSessionSecs,
  onMinSessionSecsChange,
  trackerHealth,
  getHistorySeedSnapshot,
  loadHistorySnapshot,
  mappingVersion = 0,
  selectedDateRequest = null,
  hourlyActivityChartMode,
  onHourlyActivityChartModeChange,
  refreshEnabled = true,
  webActivityEnabled = false,
  onQuickActionError,
  onInitialContentReady,
  initialDateKey,
  rangeBar,
  rangeCopy,
}: HistoryDayViewProps) {
  const requestedInitialDate = selectedDateRequest
    ? parseLocalDateKey(selectedDateRequest.dateKey)
    : initialDateKey ? parseLocalDateKey(initialDateKey) : null;
  const selectedDateRequestId = selectedDateRequest?.requestId ?? null;
  const selectedDateRequestDateKey = selectedDateRequest?.dateKey ?? null;
  const initialDate = requestedInitialDate ?? new Date();
  const datePickerRef = useRef<HTMLDivElement | null>(null);
  const calendarPopoverRef = useRef<HTMLDivElement | null>(null);
  const [selectedDate, setSelectedDate] = useState(initialDate);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(initialDate));
  const [calendarPosition, setCalendarPosition] = useState({ left: 0, top: 0 });
  const {
    contentState,
    retry,
    nowMs,
    rawDaySessions,
    rawDayAggregateSessions,
    visibleDayWebSegments,
    rawWeeklyAggregateSessions,
    hasActiveSession,
    snapshotIcons,
    requestedDateKey,
    visibleDateKey,
    visibleMappingVersion,
    webDomainFavicons,
    webFaviconsReady,
    webDomainOverrides,
  } = useHistorySnapshotRuntime({
    getHistorySeedSnapshot,
    loadHistorySnapshot,
    mappingVersion,
    refreshEnabled,
    refreshKey,
    selectedDate,
    webActivityEnabled,
  });
  const presentedDate = useMemo(
    () => (visibleDateKey ? parseLocalDateKey(visibleDateKey) ?? selectedDate : selectedDate),
    [selectedDate, visibleDateKey],
  );
  /*
   * [0.12.1 末 · 当日与往期统一] 单日也走区间那套聚合。
   *
   * 为什么要这么绕：单日页原本的"活跃时长"是 `session.duration` 累加，区间用的是
   * 墙钟 `MIN/MAX` 裁剪 —— 跨日会话、含暂停的会话在两种算法下不是同一个数，
   * 于是同一天看「单日」和看「昨日」四格会差几分钟，用户眼里就是"数据不对"。
   * 现在两边同源（后端 `cmd_get_activity_aggregate_range` + 同一份聚合函数），
   * 单日只是 `dayCount === 1` 的区间，版式也就跟着统一了。
   */
  const dayRangeData = useHistoryRangeData({
    mode: "day",
    customBounds: null,
    refreshKey,
    labels: rangeCopy,
    unnamedItemLabel: rangeCopy.unnamedItem,
    dayDateKey: visibleDateKey,
  });
  const historyIconExeNames = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const session of [
      ...rawDaySessions,
      ...rawDayAggregateSessions,
      ...rawWeeklyAggregateSessions,
    ]) {
      const exeName = session.exeName.trim();
      if (!exeName || seen.has(exeName)) continue;

      seen.add(exeName);
      result.push(exeName);
    }

    return result;
  }, [rawDayAggregateSessions, rawDaySessions, rawWeeklyAggregateSessions]);
  const baseHistoryIcons = useMemo(() => ({
    ...icons,
    ...snapshotIcons,
  }), [icons, snapshotIcons]);
  const historyIcons = useRequestedAppIcons({
    baseIcons: baseHistoryIcons,
    exeNames: historyIconExeNames,
    loadIcons: loadHistoryIconsForExecutables,
    onError: (error) => {
      console.warn("Failed to refresh history app icons:", error);
    },
  });
  const iconThemeColors = useIconThemeColors(historyIcons);
  const webDomainIcons = useMemo(() => {
    if (!webActivityEnabled) return {};
    return buildWebDomainIconMap(visibleDayWebSegments, webDomainOverrides, webDomainFavicons);
  }, [visibleDayWebSegments, webActivityEnabled, webDomainFavicons, webDomainOverrides]);
  const { colors: webDomainIconThemeColors, ready: webColorsReady } = useIconThemeColorSnapshot(webDomainIcons);
  const webSnapshotReady = visibleDayWebSegments.length > 0
    || contentState === "ready"
    || contentState === "empty"
    || contentState === "error";
  const webVisualsReady = webSnapshotReady
    && webFaviconsReady
    && webColorsReady;
  const [timelineDialogOpen, setTimelineDialogOpen] = useState(false);
  const [timelineDialogMode, setTimelineDialogMode] = useState<TimelineDialogMode>("app");
  const [timelineDialogSyncedHeight, setTimelineDialogSyncedHeight] = useState<number | null>(null);
  const [timelineZoomDialogOpen, setTimelineZoomDialogOpen] = useState(false);
  const [timelineViewport, setTimelineViewport] = useState<HistoryTimelineViewport>(() => (
    normalizeHistoryTimelineViewport({
      selectedDate: initialDate,
      requestedDurationMs: getHistoryTimelineZoomDurationMs(readHistoryTimelineZoomHours(), initialDate),
      requestedStartMs: startOfDay(initialDate).getTime(),
    })
  ));
  const [timelineDetailsPopover, setTimelineDetailsPopover] = useState<HistoryTimelineDetailsPopoverState | null>(null);
  const timelineDialogBodyRef = useRef<HTMLDivElement | null>(null);
  const timelineViewportInteractionRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsPopoverRef = useRef<HTMLDivElement | null>(null);
  const timelineDetailsTriggerRef = useRef<HTMLElement | null>(null);
  const timelineViewportWasPannedRef = useRef(false);
  const historyCopy = UI_TEXT.history;
  const destinationDetail = useHistoryDestinationDetailEntry({
    initialDateKey: formatLocalDateKey(presentedDate),
    runtime: { refreshKey, mappingVersion, mergeThresholdSecs, trackerHealth },
    webActivityEnabled,
  });
  const {
    mode: effectiveHistoryTimelineMode,
    actionLabel: historyTimelineModeActionLabel,
    ariaLabel: historyTimelineModeAriaLabel,
    toggleMode: toggleHistoryTimelineMode,
  } = useHistoryTimelineMode(webActivityEnabled, onQuickActionError);
  const timelineSourceIcons = effectiveHistoryTimelineMode === "web"
    ? webDomainIcons
    : historyIcons;
  const resetTimelineViewportForDate = useCallback((date: Date) => {
    timelineViewportWasPannedRef.current = false;
    setTimelineViewport(normalizeHistoryTimelineViewport({
      selectedDate: date,
      requestedDurationMs: getHistoryTimelineZoomDurationMs(readHistoryTimelineZoomHours(), date),
      requestedStartMs: startOfDay(date).getTime(),
    }));
  }, []);

  useEffect(() => {
    if (webActivityEnabled) return;
    setTimelineDialogMode("app");
  }, [webActivityEnabled]);

  useEffect(() => {
    if (selectedDateRequestId === null || !selectedDateRequestDateKey) return;
    const nextDate = parseLocalDateKey(selectedDateRequestDateKey);
    if (!nextDate || startOfDay(nextDate) > startOfDay(new Date())) {
      return;
    }

    setSelectedDate(nextDate);
    setCalendarMonth(startOfMonth(nextDate));
    setCalendarOpen(false);
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
  }, [selectedDateRequestDateKey, selectedDateRequestId]);

  const toggleTimelineSessionDetails = useCallback((
    sessionId: number | string,
    appName: string,
    titleSamples: TimelineDetailTitle[],
    trigger: HTMLElement,
  ) => {
    timelineDetailsTriggerRef.current = trigger;
    setTimelineDetailsPopover((current) => {
      if (current?.sessionId === sessionId) {
        timelineDetailsTriggerRef.current = null;
        return null;
      }

      const triggerRect = trigger.getBoundingClientRect();
      const cleanedTitles = cleanTimelineDetailTitles(titleSamples, appName);
      const anchor = {
        top: triggerRect.top,
        bottom: triggerRect.bottom,
        centerX: triggerRect.left + triggerRect.width / 2,
      };
      const position = resolveTimelineDetailsPopoverPosition(anchor, cleanedTitles.length);

      return {
        sessionId,
        titleSamples: cleanedTitles,
        left: position.left,
        top: position.top,
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        anchorCenterX: anchor.centerX,
        placement: position.placement,
      };
    });
  }, []);

  const updateTimelineDetailsPopoverPosition = useCallback(() => {
    const trigger = timelineDetailsTriggerRef.current;
    if (!trigger?.isConnected) return;

    const triggerRect = trigger.getBoundingClientRect();
    const anchor = {
      top: triggerRect.top,
      bottom: triggerRect.bottom,
      centerX: triggerRect.left + triggerRect.width / 2,
    };
    const measuredHeight = timelineDetailsPopoverRef.current?.offsetHeight;

    setTimelineDetailsPopover((current) => {
      if (!current) return current;

      const position = resolveTimelineDetailsPopoverPosition(
        anchor,
        current.titleSamples.length,
        measuredHeight,
      );

      if (
        Math.abs(position.left - current.left) < 1
        && Math.abs(position.top - current.top) < 1
        && Math.abs(anchor.top - current.anchorTop) < 1
        && Math.abs(anchor.bottom - current.anchorBottom) < 1
        && Math.abs(anchor.centerX - current.anchorCenterX) < 1
        && position.placement === current.placement
      ) {
        return current;
      }

      return {
        ...current,
        left: position.left,
        top: position.top,
        anchorTop: anchor.top,
        anchorBottom: anchor.bottom,
        anchorCenterX: anchor.centerX,
        placement: position.placement,
      };
    });
  }, []);

  useLayoutEffect(() => {
    if (!timelineDetailsPopover) return undefined;
    updateTimelineDetailsPopoverPosition();
    return undefined;
  }, [timelineDetailsPopover, updateTimelineDetailsPopoverPosition]);

  useEffect(() => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    resetTimelineViewportForDate(presentedDate);
  }, [presentedDate, resetTimelineViewportForDate]);

  useEffect(() => {
    const hasLiveWebSegment = webActivityEnabled
      && visibleDayWebSegments.some((segment) => segment.endTime === null);
    const hasLiveSession = hasActiveSession
      || hasLiveWebSegment;

    if (!refreshEnabled || !hasLiveSession || trackerHealth.status !== "healthy") {
      return;
    }

    // Rust owns aggregate time bounds, including the current week when a past
    // day is selected. Refresh that snapshot instead of extrapolating totals.
    const timer = window.setInterval(() => {
      retry();
    }, refreshIntervalSecs * 1000);

    return () => {
      window.clearInterval(timer);
    };
  }, [hasActiveSession, refreshEnabled, refreshIntervalSecs, retry, trackerHealth.status, visibleDayWebSegments, webActivityEnabled]);

  const changeDate = (delta: number) => {
    const nextDate = addLocalDays(selectedDate, delta);
    if (startOfDay(nextDate) <= startOfDay(new Date())) {
      setSelectedDate(nextDate);
      setCalendarMonth(startOfMonth(nextDate));
    }
  };
  const openDatePicker = () => {
    const triggerRect = datePickerRef.current?.getBoundingClientRect();
    if (triggerRect) {
      const popoverHalfWidth = 118;
      const viewportPadding = 12;
      const centeredLeft = triggerRect.left + triggerRect.width / 2;
      setCalendarPosition({
        left: Math.min(
          Math.max(centeredLeft, popoverHalfWidth + viewportPadding),
          window.innerWidth - popoverHalfWidth - viewportPadding,
        ),
        top: triggerRect.bottom + 8,
      });
    }
    setCalendarMonth(startOfMonth(selectedDate));
    setCalendarOpen((open) => !open);
  };
  const selectCalendarDate = (date: Date) => {
    if (startOfDay(date) > startOfDay(new Date())) return;
    setSelectedDate(date);
    setCalendarMonth(startOfMonth(date));
    setCalendarOpen(false);
  };
  const today = new Date();

  useEffect(() => {
    if (!calendarOpen) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (
        !datePickerRef.current?.contains(target)
        && !calendarPopoverRef.current?.contains(target)
      ) {
        setCalendarOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCalendarOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [calendarOpen]);

  useEffect(() => {
    if (!timelineDetailsPopover) return;

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (timelineDetailsPopoverRef.current?.contains(target)) return;
      if (timelineDetailsTriggerRef.current?.contains(target)) return;
      timelineDetailsTriggerRef.current = null;
      setTimelineDetailsPopover(null);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        timelineDetailsTriggerRef.current = null;
        setTimelineDetailsPopover(null);
      }
    };
    const handleResize = () => {
      updateTimelineDetailsPopoverPosition();
    };
    const handleScroll = (event: Event) => {
      const target = event.target;
      if (target instanceof Node && timelineDetailsPopoverRef.current?.contains(target)) return;
      timelineDetailsTriggerRef.current = null;
      setTimelineDetailsPopover(null);
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("resize", handleResize);
    window.addEventListener("scroll", handleScroll, true);
    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("resize", handleResize);
      window.removeEventListener("scroll", handleScroll, true);
    };
  }, [timelineDetailsPopover, updateTimelineDetailsPopoverPosition]);

  const isToday = selectedDate.toDateString() === today.toDateString();
  const showQuietPlaceholder = visibleDateKey === null;
  const showTimelineQuietPlaceholder = shouldHideTimelineContent({
    showQuietPlaceholder,
    contentState,
    sessionCount: rawDaySessions.length,
    aggregateCount: rawDayAggregateSessions.length,
    mode: effectiveHistoryTimelineMode,
    webDataReady: webSnapshotReady,
  });
  const historyView = useMemo(
    () => (void mappingVersion, buildHistoryReadModel({
      daySessions: rawDaySessions,
      dayAggregateSessions: rawDayAggregateSessions,
      weeklyAggregateSessions: rawWeeklyAggregateSessions,
      selectedDate: presentedDate,
      nowMs,
      trackerHealth,
      minSessionSecs,
      mergeThresholdSecs,
    })),
    [mappingVersion, mergeThresholdSecs, minSessionSecs, nowMs, presentedDate, rawDayAggregateSessions, rawDaySessions, rawWeeklyAggregateSessions, trackerHealth],
  );
  const {
    compiledSessions,
    timelineSessions,
    hourlyActivity,
    hourlyCategoryActivity,
  } = historyView;
  const selectedDayRange = useMemo(() => {
    const dayStart = startOfDay(presentedDate);
    return {
      startMs: dayStart.getTime(),
      endMs: addLocalDays(dayStart, 1).getTime(),
    };
  }, [presentedDate]);
  const selectedDayDurationMs = selectedDayRange.endMs - selectedDayRange.startMs;
  const {
    fullDayView: visibleHistoryTimelineView,
    zoomView: timelineZoomTimelineView,
  } = useHistoryTimelineViews({
    sessions: compiledSessions,
    webSegments: visibleDayWebSegments,
    selectedDate: presentedDate,
    nowMs,
    mode: effectiveHistoryTimelineMode,
    appIconThemeColors: iconThemeColors,
    webIconThemeColors: webDomainIconThemeColors,
    webDomainOverrides,
    mergeThresholdSecs,
    showQuietPlaceholder: showTimelineQuietPlaceholder,
    viewport: timelineViewport,
    uiText: UI_TEXT,
  });
  const timelineWindowLabel = historyCopy.timelineWindowLabel(
    formatTimelineWindowBoundary(timelineViewport.startMs, selectedDayRange.endMs, locale),
    formatTimelineWindowBoundary(timelineViewport.endMs, selectedDayRange.endMs, locale),
  );
  const timelineZoomHours = timelineViewport.durationMs / MILLISECONDS_PER_HOUR;
  const webTimelineItems = useMemo(
    () => {
      if (!webActivityEnabled) return [];

      return buildWebTimelineItems(
        visibleDayWebSegments,
        selectedDayRange,
        nowMs,
        webDomainOverrides,
        webDomainIconThemeColors,
        mergeThresholdSecs,
        minSessionSecs,
        webDomainFavicons,
      );
    },
    [
      mergeThresholdSecs,
      minSessionSecs,
      nowMs,
      visibleDayWebSegments,
      selectedDayRange,
      webActivityEnabled,
      webDomainFavicons,
      webDomainIconThemeColors,
      webDomainOverrides,
    ],
  );
  const minSessionMinutes = clampMinute(
    Math.round(minSessionSecs / 60),
    TIMELINE_MIN_SESSION_MINUTES_RANGE.min,
    TIMELINE_MIN_SESSION_MINUTES_RANGE.max,
  );
  const canDecreaseMinSession = minSessionMinutes > TIMELINE_MIN_SESSION_MINUTES_RANGE.min;
  const canIncreaseMinSession = minSessionMinutes < TIMELINE_MIN_SESSION_MINUTES_RANGE.max;
  const updateMinSessionMinutes = (nextMinutes: number) => {
    const clampedMinutes = clampMinute(
      nextMinutes,
      TIMELINE_MIN_SESSION_MINUTES_RANGE.min,
      TIMELINE_MIN_SESSION_MINUTES_RANGE.max,
    );
    onMinSessionSecsChange?.(clampedMinutes * 60);
  };
  const getInitialTimelineZoomFocusMs = useCallback(() => {
    return snapHistoryTimelineFocusToNearestHalfHour({
      selectedDate: presentedDate,
      requestedTimeMs: resolveTimelineFocusAtReferenceLocalTime({
        selectedDate: presentedDate,
        referenceTimeMs: nowMs,
      }),
    });
  }, [nowMs, presentedDate]);
  const handleTimelineZoomChange = (requestedHours: number) => {
    const nextDurationMs = getHistoryTimelineZoomDurationMs(requestedHours, presentedDate);
    const nextZoomHours = nextDurationMs / MILLISECONDS_PER_HOUR;
    if (Math.abs(nextDurationMs - timelineViewport.durationMs) < 1) return;

    const currentCenterMs = timelineViewport.startMs
      + timelineViewport.durationMs / 2;
    const focusTimeMs = timelineViewportWasPannedRef.current
      ? currentCenterMs
      : getInitialTimelineZoomFocusMs();
    const nextViewport = normalizeHistoryTimelineViewportAroundFocus({
      selectedDate: presentedDate,
      durationMs: nextDurationMs,
      focusTimeMs,
    });

    if (nextDurationMs >= selectedDayDurationMs) {
      timelineViewportWasPannedRef.current = false;
    }
    rememberHistoryTimelineZoomHours(nextZoomHours);
    setTimelineViewport(nextViewport);
  };
  const handleTimelineViewportChange = useCallback((
    nextViewport: HistoryTimelineViewport,
    reason: HistoryTimelineViewportChangeReason,
  ) => {
    if (reason === "pan") {
      timelineViewportWasPannedRef.current = true;
    } else {
      const nextZoomHours = nextViewport.durationMs / MILLISECONDS_PER_HOUR;
      rememberHistoryTimelineZoomHours(nextZoomHours);
      if (nextViewport.durationMs >= selectedDayDurationMs) {
        timelineViewportWasPannedRef.current = false;
      }
    }
    setTimelineViewport(nextViewport);
  }, [selectedDayDurationMs]);
  const {
    isDragging: timelineViewportIsDragging,
    cancelInteraction: cancelTimelineViewportInteraction,
    interactionProps: timelineViewportInteractionProps,
  } = useHistoryTimelineViewportInteraction({
    selectedDate: presentedDate,
    viewport: timelineViewport,
    enabled: timelineZoomDialogOpen,
    interactionRef: timelineViewportInteractionRef,
    onViewportChange: handleTimelineViewportChange,
  });
  const changeTimelineDialogMode = (mode: TimelineDialogMode) => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogMode(mode);
  };
  const openTimelineDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogOpen(true);
  };
  const closeTimelineDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    setTimelineDialogOpen(false);
  };
  const openTimelineZoomDialog = () => {
    timelineDetailsTriggerRef.current = null;
    setTimelineDetailsPopover(null);
    timelineViewportWasPannedRef.current = false;
    const nextZoomHours = readHistoryTimelineZoomHours();
    const nextViewport = normalizeHistoryTimelineViewportAroundFocus({
      selectedDate: presentedDate,
      durationMs: getHistoryTimelineZoomDurationMs(nextZoomHours, presentedDate),
      focusTimeMs: getInitialTimelineZoomFocusMs(),
    });
    setTimelineViewport(nextViewport);
    setTimelineZoomDialogOpen(true);
  };
  const closeTimelineZoomDialog = () => {
    cancelTimelineViewportInteraction();
    setTimelineZoomDialogOpen(false);
  };
  useEffect(() => {
    if (timelineDialogOpen) return;
    setTimelineDialogSyncedHeight(null);
  }, [timelineDialogOpen]);

  useLayoutEffect(() => {
    if (!timelineDialogOpen) return;
    const body = timelineDialogBodyRef.current;
    if (!body) return;

    const measuredHeight = Math.ceil(body.getBoundingClientRect().height);
    if (measuredHeight <= 0) return;

    setTimelineDialogSyncedHeight((current) => (
      current === null || measuredHeight > current ? measuredHeight : current
    ));
  }, [
    showQuietPlaceholder,
    minSessionMinutes,
    presentedDate,
    timelineDialogMode,
    timelineDialogOpen,
    timelineSessions.length,
    webTimelineItems.length,
  ]);

  const timelineDialogBodyStyle = timelineDialogSyncedHeight === null
    ? undefined
    : ({ minHeight: `${timelineDialogSyncedHeight}px` } satisfies CSSProperties);
  const timelineActionLabels = {
    modeTitle: historyTimelineModeActionLabel,
    modeAriaLabel: historyTimelineModeAriaLabel,
    zoomTitle: historyCopy.openTimelineZoom,
    openTitle: historyCopy.openTimeline,
  };
  const renderTimelineModeAction = (className = "") => (
    <HistoryTimelineModeButton
      labels={timelineActionLabels}
      className={className}
      onToggle={toggleHistoryTimelineMode}
    />
  );
  const timelineAxisActions = (
    <HistoryTimelineActionButtons
      labels={timelineActionLabels}
      modeClassName="history-horizontal-timeline-mode-toggle"
      onToggleMode={toggleHistoryTimelineMode}
      onOpenZoom={openTimelineZoomDialog}
      onOpenTimeline={openTimelineDialog}
    />
  );
  const effectiveTimelineDialogMode = webActivityEnabled ? timelineDialogMode : "app";
  const timelineDialogModeOptions: QuietSegmentedFilterOption<TimelineDialogMode>[] = webActivityEnabled
    ? [
      { value: "app", label: historyCopy.timelineTabApp },
      { value: "web", label: historyCopy.timelineTabWeb },
    ]
    : [
      { value: "app", label: historyCopy.timelineTabApp },
    ];
  const renderTimelineList = (className = "") => (
    <HistoryTimelineList
      loading={showQuietPlaceholder}
      timelineSessions={timelineSessions}
      icons={historyIcons}
      iconThemeColors={iconThemeColors}
      detailsPopover={timelineDetailsPopover}
      className={className}
      onToggleSessionDetails={toggleTimelineSessionDetails}
    />
  );
  const renderWebTimelineList = (className = "") => (
    <HistoryWebTimelineList
      loading={showQuietPlaceholder || !webVisualsReady}
      items={webTimelineItems}
      detailsPopover={timelineDetailsPopover}
      className={className}
      onToggleSessionDetails={toggleTimelineSessionDetails}
    />
  );
  const meaningfulContent = hasMeaningfulHistoryContent({
    contentState, visibleDateKey, requestedDateKey, visibleMappingVersion,
    requestedMappingVersion: mappingVersion, timelineContentHidden: showTimelineQuietPlaceholder,
    timelineSegmentCount: visibleHistoryTimelineView.segments.length,
  });
  useLayoutEffect(() => {
    if (contentState === "error" || meaningfulContent) onInitialContentReady?.();
  }, [contentState, meaningfulContent, onInitialContentReady]);

  /* [P0-03 ③] focusApp → 高亮键（纯派生，零 state / 零 effect / 零滚动定位）。
     「请求日期 == 当前呈现日期」这一条同时兼任生效范围与自动失效：用户翻到别的日期时
     高亮自己就没了，不需要任何清理逻辑，也不会留着「昨天的应用还亮着」的脏态。
     overview 轨是 0–24h 定宽的绝对定位容器（段用 left/width 百分比），根本没有横向滚动
     目标，所以「滚动到该应用」这个动作在本页不成立——点亮就是正解。 */
  const highlightedApp = selectedDateRequest && visibleDateKey === selectedDateRequest.dateKey
    ? selectedDateRequest.focusApp ?? null
    : null;
  /* [P0-05] 点中的活动段 → 弹「在 Timing 计这件事」（null = 弹卡关着） */
  const [activityActionTarget, setActivityActionTarget] = useState<HistoryActivityActionTarget | null>(null);

  return (
    <div
      className="flex-1 min-h-0 flex flex-col gap-4 md:gap-5 h-full overflow-hidden"
      data-history-content-state={contentState}
      data-history-content-date={visibleDateKey ?? ""}
      data-history-requested-date={requestedDateKey}
      data-history-content-mapping-version={visibleMappingVersion ?? ""}
      data-history-requested-mapping-version={mappingVersion}
      data-history-content-meaningful={meaningfulContent}
    >
      <HistoryDateHeader
        datePickerRef={datePickerRef}
        calendarPopoverRef={calendarPopoverRef}
        presentedDate={presentedDate}
        readState={{ failed: contentState === "error", hasSnapshot: visibleDateKey !== null, requestedDate: selectedDate, retry }}
        today={today}
        isToday={isToday}
        calendarOpen={calendarOpen}
        calendarPosition={calendarPosition}
        calendarMonth={calendarMonth}
        onCalendarMonthChange={setCalendarMonth}
        onChangeDate={changeDate}
        onOpenDatePicker={openDatePicker}
        onSelectCalendarDate={selectCalendarDate}
        rangeBar={rangeBar}
      />

      <div className="qp-panel p-5 history-overview-timeline-card">
        <HistoryHorizontalTimeline
          viewModel={visibleHistoryTimelineView}
          mode={effectiveHistoryTimelineMode}
          title={historyCopy.timelineAxis}
          actions={showQuietPlaceholder ? null : timelineAxisActions}
          highlightSourceKey={highlightedApp}
          onSegmentActivate={setActivityActionTarget}
          showEmptyMessage
          emptyMessage={showTimelineQuietPlaceholder ? "" : undefined}
        />
        {/* [P0-02] Timing 泳道：与上面那张活动轨**共用同一个 viewModel**，所以视口边界、
            日界、「现在」三者天然同轴；无记录时组件内部返回 null，不留空泳道。 */}
        {showQuietPlaceholder ? null : (
          <HistoryTimingLane viewModel={visibleHistoryTimelineView} highlightSourceKey={highlightedApp} />
        )}
      </div>

      {/*
       * [0.12.1 末 · 当日与往期统一] 单日主体 = 区间视图的 `dayCount === 1` 版本：
       * **同一组组件、同一套口径**（墙钟裁剪），只是没有逐日柱。
       * 原来这套「三行摘要 + 计时重叠 + 环形应用分布」是另一份格式、另一份算法，
       * 同一天在「单日」和「昨日」下会给出不同的数字，用户看到的就是"数据对不上"。
       * 时间轴 / 泳道 / 每小时活动仍是单日独有 —— 那是时序信息，区间给不了。
       * 「区间给不了」只对**这一根可缩放的轴**成立：区间另有一份逐日时间轴
       * （`HistoryRangeTimeline`，一行一天），所以这里把 `showTimeline` 关掉，
       * 免得同一天在页面上出现两条"时间轴"。
       */}
      <HistoryRangeView
        copy={rangeCopy}
        uiText={UI_TEXT}
        locale={locale}
        data={dayRangeData}
        onOpenDay={() => undefined}
        showDailyBars={false}
        showTimeline={false}
        extraBlock={(
          <HistoryHourlyActivityPanel
            mode={hourlyActivityChartMode}
            hourlyActivity={hourlyActivity}
            hourlyCategoryActivity={hourlyCategoryActivity}
            showQuietPlaceholder={showQuietPlaceholder}
            actionLabel={getHourlyActivityModeActionLabel(hourlyActivityChartMode, historyCopy)}
            onToggleMode={() => onHourlyActivityChartModeChange(
              hourlyActivityChartMode === "category" ? "total" : "category",
            )}
          />
        )}
      />

      <HistoryTimelineDetailsPopover
        popover={timelineDetailsPopover}
        popoverRef={timelineDetailsPopoverRef}
      />

      <QuietDialog
        open={timelineDialogOpen}
        title={UI_TEXT.history.timeline}
        surfaceClassName="history-timeline-dialog-surface"
        onClose={closeTimelineDialog}
      >
        <button
          type="button"
          className="qp-dialog-close-button history-timeline-dialog-close"
          aria-label={UI_TEXT.common.close}
          onClick={closeTimelineDialog}
        >
          <X size={16} aria-hidden />
        </button>
        <div
          ref={timelineDialogBodyRef}
          className="history-timeline-dialog-body"
          style={timelineDialogBodyStyle}
        >
          <div className="history-timeline-dialog-toolbar">
            <div className="history-timeline-dialog-toolbar-main">
              {webActivityEnabled && (
                <QuietSegmentedFilter<TimelineDialogMode>
                  value={effectiveTimelineDialogMode}
                  options={timelineDialogModeOptions}
                  onChange={changeTimelineDialogMode}
                  className="history-timeline-dialog-mode-switch"
                />
              )}
              <span className="history-timeline-dialog-meta">
                {UI_TEXT.history.sessionCount(
                  effectiveTimelineDialogMode === "web" ? webTimelineItems.length : timelineSessions.length,
                )}
              </span>
            </div>
            <HistoryTimelineDialogDateControls
              selectedDate={presentedDate}
              requestedDate={selectedDate}
              isToday={isToday}
              onChangeDate={changeDate}
              className="history-timeline-dialog-date-controls"
            />
            <div className="history-timeline-dialog-actions">
              <HistoryMinDurationControl
                minutes={minSessionMinutes}
                canDecrease={canDecreaseMinSession}
                canIncrease={canIncreaseMinSession}
                valueLabel={UI_TEXT.settings.minuteValue(minSessionMinutes)}
                decreaseLabel={UI_TEXT.accessibility.history.decreaseMinDuration}
                increaseLabel={UI_TEXT.accessibility.history.increaseMinDuration}
                className="history-timeline-dialog-duration-controls"
                onChange={updateMinSessionMinutes}
              />
            </div>
          </div>
          {effectiveTimelineDialogMode === "web"
            ? renderWebTimelineList("history-timeline-dialog-list")
            : renderTimelineList("history-timeline-dialog-list")}
        </div>
      </QuietDialog>

      <HistoryTimelineZoomDialog
        open={timelineZoomDialogOpen}
        onClose={closeTimelineZoomDialog}
        zoomHours={timelineZoomHours}
        onZoomHoursChange={handleTimelineZoomChange}
        windowLabel={timelineWindowLabel}
        modeAction={renderTimelineModeAction("history-timeline-zoom-dialog-mode-toggle")}
        interactionRef={timelineViewportInteractionRef}
        interactionProps={timelineViewportInteractionProps}
        interactionLabel={historyCopy.timelineInteractionHint}
        isDragging={timelineViewportIsDragging}
        viewModel={timelineZoomTimelineView}
        mode={effectiveHistoryTimelineMode}
        sourceIcons={timelineSourceIcons}
        showEmptyMessage={!showTimelineQuietPlaceholder}
        emptyMessage={historyCopy.emptyTimelineWindow}
      />

      {destinationDetail.dialog}
      {activityActionTarget && (
        <HistoryActivityActionDialog target={activityActionTarget} onClose={() => setActivityActionTarget(null)} />
      )}
    </div>
  );
}
