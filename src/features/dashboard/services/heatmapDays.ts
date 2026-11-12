/**
 * 活动热力图卡 · **周一→周日 7 行 × 24 列**的分桶与累加（纯函数）。
 *
 * 口径照搬 Rust 版 `widgets/heatmap.rs`（主人认可的那一版）：
 *   · 行是**固定的星期**，不是"滚动 7 天" —— 「周一那一行」每周都对得上，
 *     滚动窗口的 7 行每周都在夜里挪一格，读不出「我的作息」；
 *   · 取**近 4 周**、按「平均每周多少」着色，不同长度的窗口才能直接比；
 *   · 强度用 `sqrt` 压，**按窗口峰值归一**：活动分布长尾很重（大部分格子只有几分钟），
 *     线性映射会让满屏都接近空白。
 *
 * 与趋势卡同一条取数路（`cmd_get_activity_aggregate_range` + 桶边界），只是一条查询
 * 要 28 天 × 24 小时的桶（672 个，后端上限 5000，仍是单次读取）。
 *
 * 三个静默坑：
 *   ① 日界必须是**本地 00:00**（`startOfLocalDay`），按 UTC 切会整档偏一天；
 *   ② 后端要求边界**首 == startMs、末 == endMs 且严格递增**，差一毫秒整条读取就失败；
 *   ③ **今天只到此刻**：未来的小时不进分母（否则今天那一行平均被"还没发生"的时段拉低）。
 */
import { addLocalDays, formatLocalDateKey, startOfLocalDay } from "../../../shared/lib/localDate.ts";

/** 取几周：4 周是「同一星期几有 4 个样本」的最小值，再少就是单天运气 */
export const HEATMAP_WEEKS = 4;
/** 行数固定 7（周一→周日），列固定 24 —— 不随窗口天数变 */
export const HEATMAP_ROWS = 7;
export const HEATMAP_HOURS = 24;
const HOUR_MS = 3600_000;

export interface HeatmapDayWindow {
  /** 本地日 key（`YYYY-MM-DD`） */
  key: string;
  startMs: number;
  endMs: number;
  /** 0 = 周一 … 6 = 周日（不是 JS 的 0 = 周日，见 `mondayIndex`） */
  weekday: number;
}

export interface HeatmapCellWindow {
  dayIndex: number;
  weekday: number;
  hour: number;
  startMs: number;
  endMs: number;
}

export interface HeatmapPlan {
  startMs: number;
  endMs: number;
  /** 交给后端的桶边界：`[startMs, …每格 end…]`，长度 = 格数 + 1 */
  boundaries: number[];
  days: HeatmapDayWindow[];
  cells: HeatmapCellWindow[];
}

/** 一行 = 一个星期几（周一在前），`cells[hour]` = **平均每周**该小时的毫秒数 */
export interface HeatmapRow {
  weekday: number;
  /** 这一行最近一次的日期，用来生成"周一/周三"标签（不自己拼字符串，走 Intl） */
  sampleStartMs: number;
  cells: number[];
}

export interface HeatmapModel {
  rows: HeatmapRow[];
  /** 全格峰值（归一用）；全空时 0 */
  maxMs: number;
  /** 平均每周合计（卡头读数） */
  weeklyTotalMs: number;
  /** 实际覆盖到的周数（窗口不足 4 周时更小，卡头与读屏文案要说实话） */
  weeks: number;
}

/** 空模型：钩子在首帧（还没读到数据）与全空时都用它，组件不必处理 `null` */
export function emptyHeatmapModel(): HeatmapModel {
  return {
    rows: Array.from({ length: HEATMAP_ROWS }, (_, weekday) => ({
      weekday,
      sampleStartMs: 0,
      cells: new Array<number>(HEATMAP_HOURS).fill(0),
    })),
    maxMs: 0,
    weeklyTotalMs: 0,
    weeks: HEATMAP_WEEKS,
  };
}

/** JS 的 `getDay()` 是 0=周日，这里统一成 0=周一（Rust 版的 `weekday_short(0)` 也是周一） */
export function mondayIndex(date: Date): number {
  return (date.getDay() + 6) % 7;
}

export function buildHeatmapPlan(nowMs: number, weeks: number = HEATMAP_WEEKS): HeatmapPlan {
  const span = Math.max(1, Math.floor(weeks)) * HEATMAP_ROWS;
  const today = startOfLocalDay(new Date(nowMs));
  const first = addLocalDays(today, -(span - 1));

  const days: HeatmapDayWindow[] = [];
  const cells: HeatmapCellWindow[] = [];

  for (let index = 0; index < span; index += 1) {
    const start = addLocalDays(first, index);
    const dayStart = start.getTime();
    /* 今天右端裁到"此刻"：未来的小时不是"零活动"，是不该进分母 */
    const rawEnd = index === span - 1 ? nowMs : addLocalDays(start, 1).getTime();
    const dayEnd = Math.max(dayStart, rawEnd);
    const weekday = mondayIndex(start);
    days.push({ key: formatLocalDateKey(start), startMs: dayStart, endMs: dayEnd, weekday });

    for (let hour = 0; hour < HEATMAP_HOURS; hour += 1) {
      const cellStart = dayStart + hour * HOUR_MS;
      const cellEnd = Math.min(cellStart + HOUR_MS, dayEnd);
      if (cellEnd > cellStart) cells.push({ dayIndex: index, weekday, hour, startMs: cellStart, endMs: cellEnd });
    }
  }

  const startMs = days[0].startMs;
  const endMs = days[days.length - 1].endMs;
  /* 边界直接从格子推：首 / 末 / 严格递增三条都由构造保证（拼错就是整条读取失败，
   * 前端只看到"没有数据"）。 */
  const boundaries = [startMs];
  for (const cell of cells) {
    if (cell.endMs > boundaries[boundaries.length - 1]) boundaries.push(cell.endMs);
  }

  return { startMs, endMs, boundaries, days, cells };
}

interface RangeRecord {
  startTime: number;
  endTime: number;
}

/**
 * 每条记录与**每一格**求交集，按 (星期几, 小时) 累加，再除以各自的样本数。
 *
 * 分母是**有样本的次数**而不是固定 4：今天 15 点以后还没发生，那些格的样本只有 3 个，
 * 拿 4 去平均会把整行的傍晚压下去（看起来像"我傍晚不干活"）。
 */
export function accumulateHeatmap(
  plan: HeatmapPlan,
  records: readonly RangeRecord[],
): HeatmapModel {
  const totals = Array.from({ length: HEATMAP_ROWS }, () => new Array<number>(HEATMAP_HOURS).fill(0));
  const samples = Array.from({ length: HEATMAP_ROWS }, () => new Array<number>(HEATMAP_HOURS).fill(0));

  for (const cell of plan.cells) samples[cell.weekday][cell.hour] += 1;

  for (const record of records) {
    const start = Number(record.startTime);
    const end = Number(record.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
    for (const cell of plan.cells) {
      const overlap = Math.min(end, cell.endMs) - Math.max(start, cell.startMs);
      if (overlap > 0) totals[cell.weekday][cell.hour] += overlap;
    }
  }

  /* 每行的"最近一次"日期：标签用它走 Intl，不在数据层拼中文 */
  const sampleStart = new Array<number>(HEATMAP_ROWS).fill(plan.startMs);
  for (const day of plan.days) sampleStart[day.weekday] = day.startMs;
  const weeks = Math.max(1, Math.round(plan.days.length / HEATMAP_ROWS));

  const rows: HeatmapRow[] = [];
  let maxMs = 0;
  let weeklyTotalMs = 0;
  for (let weekday = 0; weekday < HEATMAP_ROWS; weekday += 1) {
    const cellsOfRow = totals[weekday].map((total, hour) => {
      const count = samples[weekday][hour];
      return count > 0 ? total / count : 0;
    });
    for (const value of cellsOfRow) {
      if (value > maxMs) maxMs = value;
      weeklyTotalMs += value;
    }
    rows.push({ weekday, sampleStartMs: sampleStart[weekday], cells: cellsOfRow });
  }

  return { rows, maxMs, weeklyTotalMs, weeks };
}

/**
 * 色阶 0–5：**先开方再分 5 档**（照 Rust 版的 `sqrt` 压长尾）。
 *
 * 不按固定分钟数分档：4 周平均之后，一小时里 20 分钟就算"很满"了，
 * 写死 15/30/45 的门槛会让整张图永远停在最浅一档。
 */
export function heatmapLevel(averageMs: number, maxMs: number): 0 | 1 | 2 | 3 | 4 | 5 {
  if (!(averageMs > 0) || !(maxMs > 0)) return 0;
  const t = Math.min(1, Math.max(0.1, Math.sqrt(averageMs / maxMs)));
  return Math.min(5, Math.max(1, Math.ceil(t * 5))) as 1 | 2 | 3 | 4 | 5;
}

/** 最忙的那一格：全空则 `null`（读屏摘要与"最集中在…"用） */
export function peakHeatmapCell(model: HeatmapModel): { weekday: number; hour: number; ms: number } | null {
  let best: { weekday: number; hour: number; ms: number } | null = null;
  for (const row of model.rows) {
    for (let hour = 0; hour < row.cells.length; hour += 1) {
      const ms = row.cells[hour];
      if (ms > 0 && (best === null || ms > best.ms)) best = { weekday: row.weekday, hour, ms };
    }
  }
  return best;
}
