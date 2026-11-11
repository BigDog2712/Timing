import { addLocalDays } from "../../../shared/lib/localDate.ts";
import type { HistoryRangeDay } from "./historyRange.ts";

/**
 * 区间时间轴：**每天一条 0–24h 的活动带**（纯函数，零 React / 零 IO）。
 * -----------------------------------------------------------------------------
 * 为什么不是把单日那根轴拉长成一条：单日轴是 0–24h 连续坐标，30 天拼成一根轴后，
 * 一次 3 小时的专注只占 0.4% 宽，画出来是一条不可见的细线，读不出版式也读不出节奏。
 * 按天分行、每行独立 0–24h，才能同时看清「哪几天在干活」与「那几天几点在干活」。
 *
 * 为什么要**分格取主导**而不是原样画每条会话：真实库里一天几百条会话
 * （窗口一切换就是一条），30 天实测上万条。原样画 = 上万个 DOM 节点，页面直接卡死；
 * 而且相邻两条经常是同一应用的不同窗口，分开画反而看不出是"一段连续工作"。
 * 所以先把一天切成固定格，每格取占时最长的应用，再把相邻同应用的格子合并成一整块 ——
 * 格宽随区间长度放大（见 `resolveRangeTimelineCellMs`），跨度越大看得越粗，
 * 这与"区间总览"的定位一致；要看细节点这一行就回单日。
 *
 * 三处口径与四格摘要 / 逐日柱严格同源，别在这里另立一套：
 *   1. 日界是**本地 00:00**（`days` 由 `historyRange.ts` 给，这里只用它的 startMs）；
 *   2. 今天的右端裁到**此刻**（`day.endMs` 已经是 `min(次日 00:00, nowMs)`）；
 *   3. 分母是**完整一天的长度**，不是 `day.endMs - day.startMs` —— 否则今天的带子会被
 *      横向拉满整个宽度，看着像"今天全天都在忙"。
 */
const MINUTE_MS = 60_000;

export interface HistoryRangeTimelineSession {
  exeName: string;
  appName: string;
  startMs: number;
  endMs: number;
}

export interface HistoryRangeTimelineBlock {
  /** 应用键（可执行名优先）：同键跨天共用同一颜色 */
  key: string;
  label: string;
  startMs: number;
  endMs: number;
  /** 相对该日 00:00 的位置与宽度（分母 = 完整一天） */
  leftRatio: number;
  widthRatio: number;
}

export interface HistoryRangeTimelineLane {
  dateKey: string;
  startMs: number;
  /** 可见右端：今天 = 此刻，往日 = 次日 00:00 */
  viewEndMs: number;
  /** 分母（完整一天的长度；DST 那天不是 24h，所以必须由日期算，不能写死） */
  spanMs: number;
  blocks: HistoryRangeTimelineBlock[];
}

/**
 * 格宽随跨度放大：一天看得细（5 分钟），一个月看得粗（15 分钟）。
 * 上限同时约束了 DOM 规模 —— 每天最多 288 / 144 / 96 块，与库里有多少条会话无关。
 */
export function resolveRangeTimelineCellMs(dayCount: number): number {
  if (dayCount <= 2) return 5 * MINUTE_MS;
  if (dayCount <= 7) return 10 * MINUTE_MS;
  return 15 * MINUTE_MS;
}

function sessionKey(session: HistoryRangeTimelineSession): string {
  return session.exeName.trim().toLowerCase() || session.appName.trim().toLowerCase();
}

function sessionLabel(session: HistoryRangeTimelineSession): string {
  return session.appName.trim() || session.exeName.trim();
}

interface CellWinner {
  key: string;
  ms: number;
}

export function buildHistoryRangeTimeline(
  days: HistoryRangeDay[],
  sessions: HistoryRangeTimelineSession[],
): HistoryRangeTimelineLane[] {
  if (days.length === 0) return [];

  const labels = new Map<string, string>();
  for (const session of sessions) {
    const key = sessionKey(session);
    if (key && !labels.has(key)) labels.set(key, sessionLabel(session));
  }

  const cellMs = resolveRangeTimelineCellMs(days.length);
  return days.map((day) => buildLane(day, sessions, cellMs, labels));
}

function buildLane(
  day: HistoryRangeDay,
  sessions: HistoryRangeTimelineSession[],
  cellMs: number,
  labels: Map<string, string>,
): HistoryRangeTimelineLane {
  const dayStartMs = day.startMs;
  const spanMs = Math.max(cellMs, addLocalDays(new Date(dayStartMs), 1).getTime() - dayStartMs);
  const viewEndMs = Math.min(dayStartMs + spanMs, Math.max(day.endMs, dayStartMs));
  const cellCount = Math.ceil(spanMs / cellMs);
  const perCell = new Array<Map<string, number> | null>(cellCount).fill(null);

  for (const session of sessions) {
    if (session.endMs <= dayStartMs || session.startMs >= viewEndMs) continue;
    const clipStart = Math.max(session.startMs, dayStartMs);
    const clipEnd = Math.min(session.endMs, viewEndMs);
    if (clipEnd <= clipStart) continue;
    const key = sessionKey(session);
    if (!key) continue;

    const firstCell = Math.floor((clipStart - dayStartMs) / cellMs);
    const lastCell = Math.min(cellCount - 1, Math.floor((clipEnd - 1 - dayStartMs) / cellMs));
    for (let index = Math.max(0, firstCell); index <= lastCell; index += 1) {
      const cellStartMs = dayStartMs + index * cellMs;
      const overlap = Math.min(clipEnd, cellStartMs + cellMs) - Math.max(clipStart, cellStartMs);
      if (overlap <= 0) continue;
      const bucket = perCell[index] ?? new Map<string, number>();
      bucket.set(key, (bucket.get(key) ?? 0) + overlap);
      perCell[index] = bucket;
    }
  }

  const winners: Array<CellWinner | null> = perCell.map((bucket) => {
    if (!bucket) return null;
    let best: CellWinner | null = null;
    for (const [key, ms] of bucket) {
      /* 同长时按键名定序：同一份数据必须每次画得一模一样，否则每次刷新都在抖 */
      if (!best || ms > best.ms || (ms === best.ms && key < best.key)) best = { key, ms };
    }
    return best;
  });

  const blocks: HistoryRangeTimelineBlock[] = [];
  let runStart = -1;
  let runKey = "";
  const flush = (runEndExclusive: number) => {
    if (runStart < 0) return;
    const startMs = dayStartMs + runStart * cellMs;
    const endMs = Math.min(dayStartMs + runEndExclusive * cellMs, viewEndMs);
    runStart = -1;
    if (endMs <= startMs) return;
    blocks.push({
      key: runKey,
      label: labels.get(runKey) ?? runKey,
      startMs,
      endMs,
      leftRatio: (startMs - dayStartMs) / spanMs,
      widthRatio: (endMs - startMs) / spanMs,
    });
  };

  for (let index = 0; index < winners.length; index += 1) {
    const winner = winners[index];
    if (!winner) {
      flush(index);
      continue;
    }
    if (runStart >= 0 && winner.key === runKey) continue;
    flush(index);
    runStart = index;
    runKey = winner.key;
  }
  flush(winners.length);

  return { dateKey: day.dateKey, startMs: dayStartMs, viewEndMs, spanMs, blocks };
}
