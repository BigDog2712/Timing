import type { Locale } from "../../../shared/i18n/index.ts";
import { formatDuration, formatTime } from "./historyFormatting.ts";
import type { HistoryDaySummaryView } from "../components/HistoryDaySummaryPanel.tsx";

/**
 * 单日摘要卡的三行数字（活跃时长 / 活跃跨度 / 高峰时段）。
 *
 * 从 `History.tsx` 搬出来的（那份文件冻结在 1147 行，接区间视图前必须等量腾空间），
 * 逻辑一字未改。两条口径值得记住，它们都是"看起来一样、算出来不一样"的坑：
 *   · **活跃跨度**只取 ≥1 分钟的会话，但如果一分钟以上的会话一条都没有，
 *     就退回用全部活跃会话——否则"只闪了一下的应用"会把跨度压成一个点。
 *   · **高峰时段**在分钟数相同时，比左右相邻小时的和：并列时取"更连续"的那个钟点，
 *     否则同样 30 分钟的高峰会在两个相邻小时之间随机跳。
 */
export const DAY_SUMMARY_EMPTY_MARK = "—";
const MIN_SPAN_SESSION_MS = 60_000;

interface SessionLike {
  startTime: number;
  endTime: number | null;
  duration: number | null;
}

interface HourlyPointLike {
  hour: string;
  minutes: number;
}

export function buildHistoryDaySummaryView({
  compiledSessions,
  hourlyActivity,
  summaryActiveDurationMs,
  locale,
}: {
  compiledSessions: SessionLike[];
  hourlyActivity: HourlyPointLike[];
  summaryActiveDurationMs: number;
  locale: Locale;
}): HistoryDaySummaryView {
  const activeSessions = compiledSessions.filter((session) => (session.duration ?? 0) > 0);
  const significantSessions = activeSessions.filter((session) => (
    (session.duration ?? 0) >= MIN_SPAN_SESSION_MS
  ));
  const spanSessions = significantSessions.length > 0 ? significantSessions : activeSessions;
  const firstStartTime = spanSessions.reduce<number | null>((earliest, session) => (
    earliest === null ? session.startTime : Math.min(earliest, session.startTime)
  ), null);
  const lastEndTime = spanSessions.reduce<number | null>((latest, session) => {
    const endTime = session.endTime ?? session.startTime + Math.max(0, session.duration ?? 0);
    return latest === null ? endTime : Math.max(latest, endTime);
  }, null);
  const peakHour = hourlyActivity.reduce<{
    hour: string;
    minutes: number;
    surroundingMinutes: number;
  }>((peak, point, index) => {
    const surroundingMinutes = (hourlyActivity[index - 1]?.minutes ?? 0)
      + (hourlyActivity[index + 1]?.minutes ?? 0);
    if (
      point.minutes > peak.minutes
      || (point.minutes === peak.minutes && surroundingMinutes > peak.surroundingMinutes)
    ) {
      return { hour: point.hour, minutes: point.minutes, surroundingMinutes };
    }
    return peak;
  }, { hour: "", minutes: 0, surroundingMinutes: -1 });

  return {
    activeDurationLabel: summaryActiveDurationMs > 0
      ? formatDuration(summaryActiveDurationMs)
      : "0m",
    activeSpanLabel: firstStartTime !== null && lastEndTime !== null
      ? `${formatTime(firstStartTime, locale)} - ${formatTime(lastEndTime, locale)}`
      : DAY_SUMMARY_EMPTY_MARK,
    peakHourLabel: peakHour.minutes > 0
      ? `${peakHour.hour} · ${formatDuration(peakHour.minutes * 60_000)}`
      : DAY_SUMMARY_EMPTY_MARK,
  };
}

export function buildEmptyHistoryDaySummaryView(): HistoryDaySummaryView {
  return {
    activeDurationLabel: DAY_SUMMARY_EMPTY_MARK,
    activeSpanLabel: DAY_SUMMARY_EMPTY_MARK,
    peakHourLabel: DAY_SUMMARY_EMPTY_MARK,
  };
}
