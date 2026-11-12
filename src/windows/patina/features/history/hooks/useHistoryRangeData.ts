import { useCallback, useEffect, useMemo, useState } from "react";
import { formatLocalDateKey } from "../../../shared/lib/localDate.ts";
import { loadActivityAggregateRange } from "../../../platform/persistence/activityReadModelGateway.ts";
import { getSessionsInRangeWithoutTitleSamples } from "../../../platform/persistence/sessionReadRepository.ts";
import {
  loadHistoryRangeNotes,
  loadHistoryRangeRecords,
  loadHistoryRangeTodos,
} from "../../../platform/runtime/historyRangeGateway.ts";
import { loadTimingItemNames } from "../../../platform/runtime/timingOverlapGateway.ts";
import {
  buildHistoryRangeBucketBoundaries,
  resolveHistoryDayRange,
  resolveHistoryRange,
  type HistoryRangeCustomBounds,
  type HistoryRangeLabels,
  type HistoryRangeMode,
  type ResolvedHistoryRange,
} from "../services/historyRange.ts";
import {
  buildHistoryRangeAggregate,
  type HistoryRangeAggregate,
  type HistoryRangeSessionInput,
} from "../services/historyRangeAggregate.ts";

/**
 * 区间视图的取数编排（历史页 `mode !== "day"` 时才启用）。
 *
 * 三条纪律，全部照数据页 `useDataTrendSnapshot` 的既有写法：
 *   1. **`nowMs` 冻在 state 里**，不跟着每次 render 变。它一变，`endMs` 就变，
 *      `cacheKey` 跟着变 → 每帧一次全库查询。只有翻档/刷新时通过 effect 换一次。
 *   2. **换了区间不显示上一段的数**：render 期先比对 `cacheKey`（在 effect 之前），
 *      不匹配就当作"还没有数据"，不会出现"先闪一下近 30 天再变成昨日"。
 *   3. **同区间刷新时不清空**：已有聚合继续显示，新数据回来直接替换；只有换区间
 *      或首载才进 `loading`。这条是 0.12.1 修主界面闪烁的同一个教训——
 *      "有没有数据可画"与"正在取数"是两件事。
 *
 * 单个数据源失败**不拖垮整页**：应用/事项/便利贴/待办各取各的，失败的那类降级成空，
 * 四类全失败才报错。区间视图是旁证性质的复盘页，不该因为一个库半就绪就整块空白。
 */
export interface HistoryRangeDataState {
  aggregate: HistoryRangeAggregate | null;
  loading: boolean;
  error: boolean;
  retry: () => void;
  resolvedRange: ResolvedHistoryRange | null;
}

interface Params {
  mode: HistoryRangeMode;
  customBounds: HistoryRangeCustomBounds | null;
  refreshKey: number;
  labels: HistoryRangeLabels;
  unnamedItemLabel: string;
  /**
   * `mode === "day"` 时要看的那一天（`YYYY-MM-DD`）。
   *
   * [0.12.1 末] 单日档也走这套聚合：单日页原来那套 `session.duration` 累加与区间的
   * 墙钟裁剪口径不同，同一天在两边会差几分钟。单日现在等价于 `dayCount === 1` 的区间。
   */
  dayDateKey?: string | null;
}

/** 档位 → 时间窗（单日与区间共用；`null` = 还没有可算的窗口） */
function resolveWindow(
  mode: HistoryRangeMode,
  customBounds: HistoryRangeCustomBounds | null,
  dayDateKey: string | null,
  nowMs: number,
  labels: HistoryRangeLabels,
): ResolvedHistoryRange | null {
  if (mode === "day") {
    return dayDateKey ? resolveHistoryDayRange(dayDateKey, nowMs, dayDateKey) : null;
  }
  return resolveHistoryRange(
    mode,
    customBounds,
    nowMs,
    labels,
  );
}

interface RangeReadState {
  nowMs: number;
  queryKey: string | null;
  aggregate: HistoryRangeAggregate | null;
  status: "loading" | "ready" | "error";
}

const EMPTY_STATE: RangeReadState = {
  nowMs: 0,
  queryKey: null,
  aggregate: null,
  status: "loading",
};

export function useHistoryRangeData({
  mode,
  customBounds,
  refreshKey,
  labels,
  unnamedItemLabel,
  dayDateKey = null,
}: Params): HistoryRangeDataState {
  const enabled = mode !== "day" || Boolean(dayDateKey);
  const customStartDateKey = customBounds?.startDateKey ?? null;
  const customEndDateKey = customBounds?.endDateKey ?? null;
  const [retryKey, setRetryKey] = useState(0);
  const retry = useCallback(() => setRetryKey((value) => value + 1), []);
  const [state, setState] = useState<RangeReadState>(EMPTY_STATE);
  const currentDateKey = formatLocalDateKey(new Date());

  /* 必须是 memo：它是 effect 的依赖项，每次 render 造新对象 = 每帧重新取数 */
  const customWindow = useMemo(
    () => (customStartDateKey && customEndDateKey
      ? { startDateKey: customStartDateKey, endDateKey: customEndDateKey }
      : null),
    [customEndDateKey, customStartDateKey],
  );

  const resolvedRange = useMemo(() => {
    if (!enabled) return null;
    const nowMs = state.nowMs > 0 ? state.nowMs : Date.now();
    return resolveWindow(mode, customWindow, dayDateKey, nowMs, labels);
  }, [customWindow, dayDateKey, enabled, labels, mode, state.nowMs]);

  useEffect(() => {
    if (!enabled) {
      setState(EMPTY_STATE);
      return undefined;
    }
    let cancelled = false;
    const nowMs = Date.now();
    const nextRange = resolveWindow(mode, customWindow, dayDateKey, nowMs, labels);
    if (!nextRange) {
      setState({ nowMs, queryKey: null, aggregate: null, status: "loading" });
      return undefined;
    }

    const nextKey = nextRange.cacheKey;
    setState((current) => ({
      nowMs,
      queryKey: nextKey,
      aggregate: current.queryKey === nextKey ? current.aggregate : null,
      status: "loading",
    }));

    void (async () => {
      const boundaries = buildHistoryRangeBucketBoundaries(nextRange);
      const [sessions, records, items, notes, todos, timelineSessions] = await Promise.all([
        loadActivityAggregateRange(nextRange.startMs, nextRange.endMs, boundaries)
          .then((result): HistoryRangeSessionInput[] => result.records.map((record) => ({
            exeName: record.exeName,
            appName: record.appName,
            startMs: record.startTime,
            endMs: record.endTime,
          })))
          .catch((error) => {
            console.warn("Failed to read range activity:", error);
            return null;
          }),
        loadHistoryRangeRecords(nextRange.startMs, nextRange.endMs).catch((error) => {
          console.warn("Failed to read range timing records:", error);
          return null;
        }),
        loadTimingItemNames().catch((error) => {
          console.warn("Failed to read range item names:", error);
          return [];
        }),
        loadHistoryRangeNotes().catch((error) => {
          console.warn("Failed to read range notes:", error);
          return null;
        }),
        loadHistoryRangeTodos().catch((error) => {
          console.warn("Failed to read range todos:", error);
          return null;
        }),
        /* 时间轴要**真实起止时刻**：上面那份 `sessions` 已被后端按「天 × 应用」压过，
           起点统一落在当日 00:00（见 `historyRangeAggregate.timelineSessions` 的注释）。
           这里只取几何、不要标题样本（30 天几千条，标题样本会让 IPC 体积翻几倍）。 */
        getSessionsInRangeWithoutTitleSamples(nextRange.startMs, nextRange.endMs)
          .then((rows) => rows.map((row) => ({
            exeName: row.exeName,
            appName: row.appName,
            startMs: row.startTime,
            endMs: row.endTime ?? nowMs,
          })))
          .catch((error) => {
            console.warn("Failed to read range timeline sessions:", error);
            return [];
          }),
      ]);
      if (cancelled) return;

      const allFailed = sessions === null && records === null && notes === null && todos === null;
      if (allFailed) {
        setState({ nowMs, queryKey: nextKey, aggregate: null, status: "error" });
        return;
      }

      const aggregate = buildHistoryRangeAggregate({
        days: nextRange.days,
        sessions: sessions ?? [],
        records: records ?? [],
        items,
        notes: notes ?? [],
        todos: todos ?? [],
        unnamedItemLabel,
        timelineSessions,
      });
      setState({ nowMs, queryKey: nextKey, aggregate, status: "ready" });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentDateKey,
    customWindow,
    dayDateKey,
    enabled,
    labels,
    mode,
    refreshKey,
    retryKey,
    unnamedItemLabel,
  ]);

  const matchesQuery = resolvedRange !== null && state.queryKey === resolvedRange.cacheKey;
  return {
    aggregate: matchesQuery ? state.aggregate : null,
    loading: enabled && (!matchesQuery || state.status === "loading"),
    error: enabled && matchesQuery && state.status === "error",
    retry,
    resolvedRange,
  };
}
