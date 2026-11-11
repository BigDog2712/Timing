import {
  addLocalDays,
  countInclusiveLocalDays,
  formatLocalDateKey,
  parseLocalDateKey,
  startOfLocalDay,
} from "../../../shared/lib/localDate.ts";

/**
 * 历史页的**区间档位**（0.12.1 末新增）。
 * -----------------------------------------------------------------------------
 * 历史页原本只能看「某一天」：日期头 ←/→ 加日历选单日，数据也只有一个日快照。
 * 本模块只做一件事 —— 把一个档位解析成**可被数据层直接消费的时间窗**，
 * 不碰 React、不碰 IPC、不读 `Date.now()`（`nowMs` 必须显式传入）。
 *
 * 三条口径（全部有单测钉住）：
 *   1. **日界一律是本地 00:00**，与 `lib/time::rangeBounds('day')`、
 *      `historyReadModel::getDayRange` 同一条线；不用 `toISOString()`（那是 UTC，会差一天）。
 *   2. **区间右端裁剪到「现在」**：本周/近 7 天/近 30 天都含今天且只到此刻，
 *      所以 `endMs = min(次日 00:00, nowMs)`。昨天是唯一右端**早于**此刻的档位
 *      （放行到今日 00:00），否则「昨天」会把今天的记录算进去。
 *   3. **自定义框反着选也对**：起止颠倒时自动对调（用户先点 11-10 再点 11-01 是常态）。
 *
 * 档位名**不进** `shared/i18n`：那四个 locale 是按索引对齐的位置数组，
 * `generated/contract.ts` 还在 size-allowlist 里冻着（1131/1131），
 * 所以文案走 `rangeCopy.ts` 的 `Record<Locale, …>`（与 `dashboard/copy.ts` 同法）。
 */
export type HistoryRangePreset = "yesterday" | "week" | "last7" | "last30";
export type HistoryRangeMode = "day" | HistoryRangePreset | "custom";

export interface HistoryRangeCustomBounds {
  startDateKey: string;
  endDateKey: string;
}

export interface HistoryRangeLabels {
  yesterday: string;
  thisWeek: string;
  last7: string;
  last30: string;
  customRange: (startDateKey: string, endDateKey: string, dayCount: number) => string;
}

/** 区间内的一天（逐日柱、逐日桶都用它，边界已裁到 `endMs`） */
export interface HistoryRangeDay {
  dateKey: string;
  startMs: number;
  endMs: number;
}

export interface ResolvedHistoryRange {
  mode: HistoryRangeMode;
  startDateKey: string;
  endDateKey: string;
  startMs: number;
  endMs: number;
  dayCount: number;
  label: string;
  /** 数据层缓存键：同键不重查（与 `dataTrendRange::cacheKey` 同法） */
  cacheKey: string;
  days: HistoryRangeDay[];
}

export const HISTORY_RANGE_PRESETS: HistoryRangePreset[] = [
  "yesterday",
  "week",
  "last7",
  "last30",
];

function normalizeCustomBounds(
  bounds: HistoryRangeCustomBounds,
  today: Date,
): { start: Date; end: Date } {
  const left = parseLocalDateKey(bounds.startDateKey);
  const right = parseLocalDateKey(bounds.endDateKey);
  const fallback = startOfLocalDay(today);
  const a = left ?? fallback;
  const b = right ?? fallback;
  const start = a <= b ? a : b;
  const end = a <= b ? b : a;
  return { start, end: end > today ? today : end };
}

/** 逐日切片：`endMs` 只影响最后一天，前面的天都是整日 */
export function buildHistoryRangeDays(
  startDateKey: string,
  endDateKey: string,
  endMs: number,
): HistoryRangeDay[] {
  const start = parseLocalDateKey(startDateKey);
  const end = parseLocalDateKey(endDateKey);
  if (!start || !end || end < start) return [];
  const days: HistoryRangeDay[] = [];
  for (let cursor = start; cursor <= end; cursor = addLocalDays(cursor, 1)) {
    const next = addLocalDays(cursor, 1);
    days.push({
      dateKey: formatLocalDateKey(cursor),
      startMs: cursor.getTime(),
      endMs: Math.min(next.getTime(), endMs),
    });
  }
  return days;
}

function resolveBounds(
  mode: Exclude<HistoryRangeMode, "day">,
  start: Date,
  requestedEnd: Date,
  nowMs: number,
  label: string,
): ResolvedHistoryRange {
  const startDateKey = formatLocalDateKey(start);
  const requestedEndKey = formatLocalDateKey(requestedEnd);
  const endMs = Math.min(addLocalDays(requestedEnd, 1).getTime(), nowMs);
  return {
    mode,
    startDateKey,
    endDateKey: requestedEndKey,
    startMs: start.getTime(),
    endMs,
    dayCount: countInclusiveLocalDays(startDateKey, requestedEndKey),
    label,
    cacheKey: `${mode}:${startDateKey}:${requestedEndKey}`,
    days: buildHistoryRangeDays(startDateKey, requestedEndKey, endMs),
  };
}

/**
 * 档位 → 时间窗。`mode === "day"` 返回 `null`（单日视图有自己那套快照，不走这里）。
 */
export function resolveHistoryRange(
  mode: HistoryRangeMode,
  customBounds: HistoryRangeCustomBounds | null,
  nowMs: number,
  labels: HistoryRangeLabels,
): ResolvedHistoryRange | null {
  if (mode === "day") return null;

  const today = startOfLocalDay(new Date(nowMs));

  if (mode === "custom") {
    if (!customBounds) return null;
    const { start, end } = normalizeCustomBounds(customBounds, today);
    const startDateKey = formatLocalDateKey(start);
    const endDateKey = formatLocalDateKey(end);
    const dayCount = countInclusiveLocalDays(startDateKey, endDateKey);
    return resolveBounds(
      "custom",
      start,
      end,
      nowMs,
      labels.customRange(startDateKey, endDateKey, dayCount),
    );
  }

  if (mode === "yesterday") {
    const start = addLocalDays(today, -1);
    return resolveBounds("yesterday", start, start, nowMs, labels.yesterday);
  }

  if (mode === "week") {
    /* ISO 周：周一为第一天（与 `getIsoWeek` / 数据页「周」档同一条线） */
    const mondayOffset = (today.getDay() + 6) % 7;
    return resolveBounds("week", addLocalDays(today, -mondayOffset), today, nowMs, labels.thisWeek);
  }

  if (mode === "last7") {
    return resolveBounds("last7", addLocalDays(today, -6), today, nowMs, labels.last7);
  }

  return resolveBounds("last30", addLocalDays(today, -29), today, nowMs, labels.last30);
}

/**
 * 逐日桶的边界：**首元素必须是 `startMs`、末元素必须是 `endMs`**，
 * 否则后端 `validate_aggregate_boundaries` 直接报 "boundaries are invalid"
 * （它按 `windows(2)` 取桶，首尾不闭合就没有第一个/最后一个桶）。
 * 传进去以后活动聚合会按天切好桶，前端不必再猜日界，逐日柱也因此精确。
 */
export function buildHistoryRangeBucketBoundaries(range: ResolvedHistoryRange): number[] {
  return [range.startMs, ...range.days.map((day) => day.endMs)];
}

/**
 * 单日档（`mode === "day"`）也走同一条时间窗解析 —— 这是「当日与往期格式统一」的地基。
 *
 * 为什么单日不能再用自己那套：单日页原本的"活跃时长"是 `session.duration` 累加，
 * 而区间用的是**墙钟 `MIN/MAX` 裁剪**；跨日会话、含暂停的会话在两种算法下不是同一个数。
 * 于是同一天看「单日」和看「昨日」，四格里的数字会差几分钟 —— 用户眼里就是"数据不对"。
 * 现在两边共用 `cmd_get_activity_aggregate_range` + 同一份 `buildHistoryRangeAggregate`，
 * 单日只是 `dayCount === 1` 的区间。
 *
 * 右端仍按"区间右端裁到此刻"的规矩：看今天时 `endMs = nowMs`，看往日则是整日。
 */
export function resolveHistoryDayRange(
  dateKey: string,
  nowMs: number,
  label: string,
): ResolvedHistoryRange | null {
  const day = parseLocalDateKey(dateKey);
  if (!day) return null;
  const today = startOfLocalDay(new Date(nowMs));
  if (day > today) return null;
  const startMs = day.getTime();
  const endMs = Math.min(addLocalDays(day, 1).getTime(), nowMs);
  const dateKeyOfDay = formatLocalDateKey(day);
  return {
    mode: "day",
    startDateKey: dateKeyOfDay,
    endDateKey: dateKeyOfDay,
    startMs,
    endMs,
    dayCount: 1,
    label,
    cacheKey: `day:${dateKeyOfDay}`,
    days: [{ dateKey: dateKeyOfDay, startMs, endMs }],
  };
}
