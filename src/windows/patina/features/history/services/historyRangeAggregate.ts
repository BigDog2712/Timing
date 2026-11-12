import type { HistoryRangeDay } from "./historyRange.ts";
import {
  buildHistoryRangeTimeline,
  type HistoryRangeTimelineLane,
  type HistoryRangeTimelineSession,
} from "./historyRangeTimeline.ts";

/**
 * 历史页区间视图的**聚合口径**（纯函数，零 React / 零 IO）。
 * -----------------------------------------------------------------------------
 * 四类数据各有各的"这个区间里算不算"的判据，全部写死在这里，不散到组件里：
 *   · 应用 —— 按**墙钟重叠**分摊：一条会话跨了两天就按天切开（`min/ max` 裁剪，
 *     不用它的 duration 字段，那个字段在跨日会话上不等于墙钟差）。
 *   · 事项 —— 按 `startedAt` 归区间、按 `accumulatedSec` 求和，与历史页单日
 *     「同期计时」(`useTimingOverlap` → `list_records`) **同一口径**；
 *     刻意不做跨区间裁剪——累加秒数里含暂停，裁剪会把它算成"区间内真的在计时"。
 *   · 便利贴 —— 按 **createdAt** 归区间（写下的那一刻属于哪段历史）。
 *   · 待办 —— 按 **doneAt** 归区间（"这段时间完成了什么"）。
 *
 * 行数据全部返回**未截断**的全量并按降序排好，`Top N` 由组件层决定：
 * 同一份聚合能给排行卡（前 8）和汇总数字（全部）两份用途，不必算两遍。
 */
export interface HistoryRangeSessionInput {
  exeName: string;
  appName: string;
  startMs: number;
  endMs: number;
}

export interface HistoryRangeRecordInput {
  itemId: number;
  seconds: number;
  startedAt: number;
}

export interface HistoryRangeItemInput {
  id: number;
  name: string;
}

export interface HistoryRangeNoteInput {
  id: number;
  itemId: number | null;
  content: string;
  createdAt: number;
}

export interface HistoryRangeTodoInput {
  id: number;
  title: string;
  plannedAt: number | null;
  doneAt: number | null;
}

export interface HistoryRangeAppRow {
  key: string;
  name: string;
  durationMs: number;
  share: number;
}

export interface HistoryRangeItemRow {
  itemId: number;
  name: string;
  durationMs: number;
  recordCount: number;
  share: number;
}

export interface HistoryRangeNoteEntry {
  id: number;
  itemId: number | null;
  itemName: string | null;
  content: string;
  createdAt: number;
}

export interface HistoryRangeTodoEntry {
  id: number;
  title: string;
  doneAt: number;
  plannedAt: number | null;
}

export interface HistoryRangeDayBucket {
  dateKey: string;
  /** 该日 00:00 的毫秒时刻：逐日柱要拿它算"哪一天"的标签与 aria，不靠反解 dateKey */
  startMs: number;
  appMs: number;
  timingMs: number;
  noteCount: number;
  todoDoneCount: number;
}

export interface HistoryRangeAggregate {
  activityMs: number;
  timingMs: number;
  noteCount: number;
  todoDoneCount: number;
  activeDayCount: number;
  apps: HistoryRangeAppRow[];
  items: HistoryRangeItemRow[];
  notes: HistoryRangeNoteEntry[];
  todos: HistoryRangeTodoEntry[];
  days: HistoryRangeDayBucket[];
  /** 逐日时间轴（每天一条 0–24h 活动带）；无原始会话时为空数组 */
  timeline: HistoryRangeTimelineLane[];
}

export interface HistoryRangeAggregateInput {
  days: HistoryRangeDay[];
  sessions: HistoryRangeSessionInput[];
  records: HistoryRangeRecordInput[];
  items: HistoryRangeItemInput[];
  notes: HistoryRangeNoteInput[];
  todos: HistoryRangeTodoInput[];
  /** 未命名计时的显示名（宿主把无名字的计时挂在 `SYSTEM_ITEM_ID` 上） */
  unnamedItemLabel: string;
  /**
   * **原始会话**（真实起止时刻），只喂时间轴。不能拿上面那份 `sessions` 凑：那份传了逐日桶
   * 边界，后端已按「天 × 应用」压成"起点落在 00:00、长度等于当日总时长"的行 —— 时长对、
   * 位置全丢。时间轴要的是"几点到几点在哪个应用"，只能另取一份未聚合的。
   */
  timelineSessions?: HistoryRangeTimelineSession[];
}

const toMs = (seconds: number) => Math.max(0, Math.round(seconds * 1000));

function overlapMs(startMs: number, endMs: number, rangeStartMs: number, rangeEndMs: number) {
  return Math.max(0, Math.min(endMs, rangeEndMs) - Math.max(startMs, rangeStartMs));
}

function emptyAggregate(days: HistoryRangeDay[]): HistoryRangeAggregate {
  return {
    activityMs: 0,
    timingMs: 0,
    noteCount: 0,
    todoDoneCount: 0,
    activeDayCount: 0,
    apps: [],
    items: [],
    notes: [],
    todos: [],
    timeline: [],
    days: days.map((day) => ({
      dateKey: day.dateKey,
      startMs: day.startMs,
      appMs: 0,
      timingMs: 0,
      noteCount: 0,
      todoDoneCount: 0,
    })),
  };
}

function dayIndexOf(days: HistoryRangeDay[], timeMs: number): number {
  for (let index = 0; index < days.length; index += 1) {
    const day = days[index];
    if (timeMs >= day.startMs && timeMs < day.endMs) return index;
  }
  return -1;
}

/** 会话按天切开：跨日会话在两天里各占自己的那段，总和 = 区间内墙钟时长 */
function distributeSession(
  buckets: HistoryRangeDayBucket[],
  days: HistoryRangeDay[],
  session: HistoryRangeSessionInput,
): number {
  const startMs = Math.max(session.startMs, days[0].startMs);
  const endMs = Math.min(session.endMs, days[days.length - 1].endMs);
  if (!(endMs > startMs)) return 0;

  let total = 0;
  for (let index = 0; index < days.length; index += 1) {
    const slice = overlapMs(startMs, endMs, days[index].startMs, days[index].endMs);
    if (slice > 0) {
      buckets[index].appMs += slice;
      total += slice;
    }
  }
  return total;
}

export function buildHistoryRangeAggregate(
  input: HistoryRangeAggregateInput,
): HistoryRangeAggregate {
  const { days, sessions, records, items, notes, todos } = input;
  if (days.length === 0) return emptyAggregate(days);

  const aggregate = emptyAggregate(days);
  const rangeStartMs = days[0].startMs;
  const rangeEndMs = days[days.length - 1].endMs;

  /* ---- 应用 ---- */
  const appByKey = new Map<string, HistoryRangeAppRow>();
  for (const session of sessions) {
    const key = session.exeName.trim() || session.appName.trim();
    if (!key) continue;
    const durationMs = distributeSession(aggregate.days, days, session);
    if (durationMs <= 0) continue;
    const existing = appByKey.get(key);
    if (existing) {
      existing.durationMs += durationMs;
    } else {
      appByKey.set(key, {
        key,
        name: session.appName.trim() || key,
        durationMs,
        share: 0,
      });
    }
  }
  aggregate.activityMs = [...appByKey.values()].reduce((sum, row) => sum + row.durationMs, 0);
  aggregate.apps = finishRows([...appByKey.values()], aggregate.activityMs);

  /* ---- 事项 ---- */
  const itemNameById = new Map(items.map((item) => [item.id, item.name.trim()]));
  const itemById = new Map<number, HistoryRangeItemRow>();
  for (const record of records) {
    if (record.startedAt < rangeStartMs || record.startedAt >= rangeEndMs) continue;
    const durationMs = toMs(record.seconds);
    if (durationMs <= 0) continue;
    const dayIndex = dayIndexOf(days, record.startedAt);
    if (dayIndex >= 0) aggregate.days[dayIndex].timingMs += durationMs;
    const existing = itemById.get(record.itemId);
    if (existing) {
      existing.durationMs += durationMs;
      existing.recordCount += 1;
    } else {
      itemById.set(record.itemId, {
        itemId: record.itemId,
        name: itemNameById.get(record.itemId) || input.unnamedItemLabel,
        durationMs,
        recordCount: 1,
        share: 0,
      });
    }
  }
  aggregate.timingMs = [...itemById.values()].reduce((sum, row) => sum + row.durationMs, 0);
  aggregate.items = finishRows([...itemById.values()], aggregate.timingMs)
    .sort((left, right) => (
      right.durationMs - left.durationMs || right.recordCount - left.recordCount
    ));

  /* ---- 便利贴 ---- */
  aggregate.notes = notes
    .filter((note) => note.createdAt >= rangeStartMs && note.createdAt < rangeEndMs)
    .sort((left, right) => right.createdAt - left.createdAt)
    .map((note) => {
      const dayIndex = dayIndexOf(days, note.createdAt);
      if (dayIndex >= 0) aggregate.days[dayIndex].noteCount += 1;
      return {
        id: note.id,
        itemId: note.itemId,
        itemName: note.itemId === null ? null : itemNameById.get(note.itemId) ?? null,
        content: note.content,
        createdAt: note.createdAt,
      };
    });
  aggregate.noteCount = aggregate.notes.length;

  /* ---- 待办 ---- */
  aggregate.todos = todos
    .filter((todo) => todo.doneAt !== null && todo.doneAt >= rangeStartMs && todo.doneAt < rangeEndMs)
    .sort((left, right) => (right.doneAt ?? 0) - (left.doneAt ?? 0))
    .map((todo) => {
      const doneAt = todo.doneAt ?? 0;
      const dayIndex = dayIndexOf(days, doneAt);
      if (dayIndex >= 0) aggregate.days[dayIndex].todoDoneCount += 1;
      return {
        id: todo.id,
        title: todo.title,
        doneAt,
        plannedAt: todo.plannedAt,
      };
    });
  aggregate.todoDoneCount = aggregate.todos.length;

  aggregate.activeDayCount = aggregate.days.filter((day) => (
    day.appMs > 0 || day.timingMs > 0
  )).length;

  /* ---- 时间轴（独立输入：见 `timelineSessions` 的说明） ---- */
  aggregate.timeline = buildHistoryRangeTimeline(days, input.timelineSessions ?? []);

  return aggregate;
}

function finishRows<T extends { durationMs: number; share: number }>(
  rows: T[],
  totalMs: number,
): T[] {
  for (const row of rows) {
    row.share = totalMs > 0 ? row.durationMs / totalMs : 0;
  }
  return rows.sort((left, right) => right.durationMs - left.durationMs);
}
