/**
 * [应用趋势卡 · 0.12.1] 把「近 N 天每日时长」这件事拆成**可验证的纯函数**。
 *
 * 为什么要拆出来：柱子高低错了没人看得出来（它只是"看起来矮一点"），
 * 而这条链上有三个易错点，每一个都是静默的：
 *   ① 日界必须是**本地 00:00**。`toISOString()` 会按 UTC 切，东八区整档偏一天。
 *   ② 后端 `validate_aggregate_boundaries` 要求边界**首 == startMs、末 == endMs**，
 *      差一毫秒整条 activity 读取就失败（前端只看到"没有数据"）。
 *   ③ 聚合命令返回的记录已被压成「起点 = 桶起点、长度 = 该桶时长」，
 *      位置信息丢了但**时长是对的**——趋势只要时长，正好合适；也因此绝不能拿它画时间轴。
 */
import { addLocalDays, formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";

export interface TrendWindow {
  /** 本地日 key（`YYYY-MM-DD`），既是 React key 也是"这是哪天"的唯一标识 */
  key: string;
  startMs: number;
  endMs: number;
}

export interface TrendDay extends TrendWindow {
  durationMs: number;
}

export interface TrendQueryPlan {
  startMs: number;
  endMs: number;
  /** 逐日桶边界：`[startMs, day1.end, …, endMs]`，长度 = 天数 + 1 */
  boundaries: number[];
  windows: TrendWindow[];
}

/** 天数下限：少于两天没有"走势"可言，柱状图和单个数字没区别。 */
export const MIN_TREND_DAYS = 2;

export function buildTrendQueryPlan(nowMs: number, count: number): TrendQueryPlan {
  const days = Math.max(MIN_TREND_DAYS, Math.floor(count));
  const today = startOfLocalDay(new Date(nowMs));
  const first = addLocalDays(today, -(days - 1));

  const windows: TrendWindow[] = [];
  for (let index = 0; index < days; index += 1) {
    const start = addLocalDays(first, index);
    const isToday = index === days - 1;
    windows.push({
      key: formatLocalDateKey(start),
      startMs: start.getTime(),
      /* 今天右端裁到"此刻"：不然最后那根柱子的分母是未来 8 小时，永远显矮。 */
      endMs: isToday ? nowMs : addLocalDays(start, 1).getTime(),
    });
  }

  const startMs = windows[0].startMs;
  const endMs = windows[windows.length - 1].endMs;
  return {
    startMs,
    endMs,
    boundaries: [startMs, ...windows.map((window) => window.endMs)],
    windows,
  };
}

interface RangeRecord {
  startTime: number;
  endTime: number;
}

/**
 * 每条记录与**每个窗口**求交集再累加（窗口只有 7 个，不做区间树）。
 *
 * 为什么不是「按起点归日」：跨午夜的会话（23:50–00:20）按起点会整段算给前一天，
 * 后一天凭空少 20 分钟。历史页的口径就是墙钟分摊（`MIN(end, 右) − MAX(start, 左)`），
 * 两处对不上时用户会发现"趋势柱加起来 ≠ 历史页总数"。
 *
 * 边界外的残段（首尾跨出查询范围）靠同一个交集自然裁掉，不需要额外判断。
 */
export function accumulateTrendDays(windows: readonly TrendWindow[], records: readonly RangeRecord[]): TrendDay[] {
  const totals = windows.map((window) => ({ ...window, durationMs: 0 }));
  for (const record of records) {
    const start = Number(record.startTime);
    const end = Number(record.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (const day of totals) {
      const overlap = Math.min(end, day.endMs) - Math.max(start, day.startMs);
      if (overlap > 0) day.durationMs += overlap;
    }
  }
  return totals;
}
