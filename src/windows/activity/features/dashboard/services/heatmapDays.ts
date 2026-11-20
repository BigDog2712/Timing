/**
 * 活动热力图卡 · **一天 6 个四小时格 × 一个月的日期**（纯函数）。
 *
 * [2026-11-20] 主人口径换了轴：原来"周几 × 小时"的平均作息图读不出"哪一天忙"，
 * 现在**横轴是日期、纵轴是 6 个四小时段**（0–4 / 4–8 / 8–12 / 12–16 / 16–20 / 20–24），
 * 最上面一行是当天合计。一个月一页，月导航回看历史月份。
 *
 * 三条口径：
 *   · 每格是**该段内的活动毫秒数**（不是平均）：一个月里每天一格，直接比"哪天更满"；
 *   · **整月铺满**（28–31 列都在，日期轴不会月中截断）；今天只到此刻、未来的天与时段
 *     标 `futureBuckets`，渲染成"还没到"而不是零活动；
 *   · 色阶分两套分母：6 个时段行按**时段峰值**，合计行按**日峰值** —— 合计是时段的
 *     数倍，共用分母会让合计行永远满格、时段行永远最浅。
 *
 * 与趋势卡同一条取数路（`cmd_get_activity_aggregate_range` + 桶边界）：一个月最多
 * 31 天 × 6 格 = 186 个桶，单次读取（后端上限 5000）。
 *
 * 三个静默坑（照旧）：
 *   ① 日界必须是**本地 00:00**（`startOfLocalDay`），按 UTC 切会整档偏一天；
 *   ② 后端要求边界**首 == startMs、末 == endMs 且严格递增**，差一毫秒整条读取就失败；
 *   ③ 今天右端裁到"此刻"，未来桶既不进格子也不进合计。
 */
import {
  addLocalDays,
  addLocalMonths,
  formatLocalDateKey,
  startOfLocalDay,
  startOfLocalMonth,
} from "../../../shared/lib/localDate.ts";
import { distributeBucketUnionMs } from "../../../shared/lib/bucketUnion.ts";

/** 纵轴时段数：0–4 / 4–8 / 8–12 / 12–16 / 16–20 / 20–24 */
export const HEATMAP_BUCKETS = 6;
export const HEATMAP_BUCKET_HOURS = 4;
const HOUR_MS = 3600_000;

export interface HeatmapDayWindow {
  /** 本地日 key（`YYYY-MM-DD`） */
  key: string;
  startMs: number;
  /** 次日 0 点：整月每天都铺满，是否"还没到"由 `plan.endMs`（数据右端）判断 */
  endMs: number;
  dayOfMonth: number;
}

export interface HeatmapCellWindow {
  dayIndex: number;
  /** 0–5，对应 0–4 … 20–24 点 */
  bucket: number;
  startMs: number;
  endMs: number;
}

export interface HeatmapPlan {
  startMs: number;
  /** 数据的右端：当前月 = 此刻，过去月 = 月末（日期轴另有整月 `days`） */
  endMs: number;
  /** 交给后端的桶边界：`[startMs, …每格 end…]`，长度 = 格数 + 1 */
  boundaries: number[];
  days: HeatmapDayWindow[];
  cells: HeatmapCellWindow[];
  /** 本页的月份 0 点（月导航的标签与"当前月"判断用） */
  monthStartMs: number;
  monthOffset: number;
}

/** 一列 = 一天；`buckets[b]` 是该四小时段的毫秒数 */
export interface HeatmapDay {
  key: string;
  startMs: number;
  dayOfMonth: number;
  buckets: number[];
  totalMs: number;
  /** 今天里还没开始的时段下标（0–5）：渲染成"还没到"，不是零活动 */
  futureBuckets: number[];
}

export interface HeatmapModel {
  monthStartMs: number;
  days: HeatmapDay[];
  /** 6 个时段行的峰值（时段行归一用）；全空时 0 */
  bucketMaxMs: number;
  /** 日合计的峰值（合计行归一用）；全空时 0 */
  totalMaxMs: number;
  /** 本页合计（卡头读数） */
  monthTotalMs: number;
}

/** 空模型：钩子在首帧（还没读到数据）与全空时都用它，组件不必处理 `null` */
export function emptyHeatmapModel(monthStartMs = startOfLocalMonth(new Date()).getTime()): HeatmapModel {
  return { monthStartMs, days: [], bucketMaxMs: 0, totalMaxMs: 0, monthTotalMs: 0 };
}

/** 某个月份的页：`monthOffset = 0` 是当前月，`1` 是上个月（可一直往前） */
export function buildHeatmapPlan(nowMs: number, monthOffset = 0): HeatmapPlan {
  const offset = Math.max(0, Math.floor(monthOffset));
  const currentMonth = startOfLocalMonth(new Date(nowMs));
  const monthStart = addLocalMonths(currentMonth, -offset);
  const monthStartMs = monthStart.getTime();
  const monthEndMs = addLocalMonths(monthStart, 1).getTime();
  /* 取数右端：当前月只到此刻；过去的月份是整月。日期轴本身始终铺满整月 */
  const dataEndMs = offset === 0 ? Math.min(nowMs, monthEndMs) : monthEndMs;

  const days: HeatmapDayWindow[] = [];
  const cells: HeatmapCellWindow[] = [];

  let cursor = monthStartMs;
  while (cursor < monthEndMs) {
    const day = new Date(cursor);
    const dayStart = startOfLocalDay(day).getTime();
    const dayEnd = addLocalDays(day, 1).getTime();
    const dayIndex = days.length;
    days.push({
      key: formatLocalDateKey(day),
      startMs: dayStart,
      endMs: dayEnd,
      dayOfMonth: day.getDate(),
    });

    for (let bucket = 0; bucket < HEATMAP_BUCKETS; bucket += 1) {
      const start = dayStart + bucket * HEATMAP_BUCKET_HOURS * HOUR_MS;
      /* 今天还没到的时段整格跳过：进格子就会画成"零活动" */
      if (start >= dataEndMs) break;
      const end = Math.min(start + HEATMAP_BUCKET_HOURS * HOUR_MS, dataEndMs);
      cells.push({ dayIndex, bucket, startMs: start, endMs: end });
    }

    cursor = dayEnd;
  }

  /* 边界直接从格子推：首 / 末 / 严格递增三条都由构造保证（拼错就是整条读取失败，
   * 前端只看到"没有数据"）。 */
  const boundaries = [monthStartMs];
  for (const cell of cells) {
    if (cell.endMs > boundaries[boundaries.length - 1]) boundaries.push(cell.endMs);
  }
  if (days.length === 0) boundaries.push(monthStartMs + HOUR_MS);

  return {
    startMs: monthStartMs,
    endMs: boundaries[boundaries.length - 1],
    boundaries,
    days,
    cells,
    monthStartMs,
    monthOffset: offset,
  };
}

interface RangeRecord {
  startTime: number;
  endTime: number;
}

/** 后端逐桶并集（与 `trendDays` 同一份契约，见那里的注释） */
export interface HeatmapBucketUnion {
  boundaries: readonly number[];
  unionByBucket: readonly number[];
}

/**
 * 每格 = 该日该四小时段内的活动时长；合计 = 当天 6 段之和。
 *
 * 传了 `union` 就用后端的逐桶并集（多设备时这才是 union 口径），否则按记录求交集
 * （老路径，单设备数据上与并集逐格相等）。
 */
export function accumulateHeatmap(
  plan: HeatmapPlan,
  records: readonly RangeRecord[],
  union?: HeatmapBucketUnion,
): HeatmapModel {
  const totals = plan.days.map(() => new Array<number>(HEATMAP_BUCKETS).fill(0));

  if (union) {
    const perCell = distributeBucketUnionMs(union.boundaries, union.unionByBucket, plan.cells);
    for (let index = 0; index < plan.cells.length; index += 1) {
      const cell = plan.cells[index];
      totals[cell.dayIndex][cell.bucket] += perCell[index];
    }
  } else {
    for (const record of records) {
      const start = Number(record.startTime);
      const end = Number(record.endTime);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
      for (const cell of plan.cells) {
        const overlap = Math.min(end, cell.endMs) - Math.max(start, cell.startMs);
        if (overlap > 0) totals[cell.dayIndex][cell.bucket] += overlap;
      }
    }
  }

  const days: HeatmapDay[] = plan.days.map((day, index) => {
    const buckets = totals[index];
    const futureBuckets: number[] = [];
    /* 数据右端之前的段才开始过：今天之后的天、今天还没到的段都算"未来" */
    for (let bucket = 0; bucket < HEATMAP_BUCKETS; bucket += 1) {
      const start = day.startMs + bucket * HEATMAP_BUCKET_HOURS * HOUR_MS;
      if (start >= plan.endMs) futureBuckets.push(bucket);
    }
    return {
      key: day.key,
      startMs: day.startMs,
      dayOfMonth: day.dayOfMonth,
      buckets,
      totalMs: buckets.reduce((sum, value) => sum + value, 0),
      futureBuckets,
    };
  });

  let bucketMaxMs = 0;
  let totalMaxMs = 0;
  let monthTotalMs = 0;
  for (const day of days) {
    for (const value of day.buckets) {
      if (value > bucketMaxMs) bucketMaxMs = value;
    }
    if (day.totalMs > totalMaxMs) totalMaxMs = day.totalMs;
    monthTotalMs += day.totalMs;
  }

  return { monthStartMs: plan.monthStartMs, days, bucketMaxMs, totalMaxMs, monthTotalMs };
}

/**
 * 色阶 0–5：**先开方再分 5 档**（活动分布长尾很重，线性映射会让满屏都是最浅一档）。
 */
export function heatmapLevel(ms: number, maxMs: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!(ms > 0) || !(maxMs > 0)) return 0;
  const t = Math.min(1, Math.max(0.1, Math.sqrt(ms / maxMs)));
  return Math.min(5, Math.max(1, Math.ceil(t * 5))) as 1 | 2 | 3 | 4 | 5;
}

/** 最忙的那一天：全空则 `null`（读屏摘要与卡头读数用） */
export function peakHeatmapDay(model: HeatmapModel): { day: HeatmapDay; ms: number } | null {
  let best: { day: HeatmapDay; ms: number } | null = null;
  for (const day of model.days) {
    if (day.totalMs > 0 && (best === null || day.totalMs > best.ms)) best = { day, ms: day.totalMs };
  }
  return best;
}