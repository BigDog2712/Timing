import { invoke } from "@tauri-apps/api/core";

/**
 * 反向数据桥 · 区间版：分析窗读**宿主**的计时记录、便利贴、待办。
 *
 * 与 `timingOverlapGateway.ts` 同一套路（同一个窗口、同一份 ACL 桥
 * `permissions/patina-host-bridge.toml`），区别只有两点：
 *   1. `list_records` 要**翻页**：单日几十条够用，30 天可能上千条，
 *      而宿主的 `limit` 上限是 100/页（`types/domain-params.ts`）。
 *   2. 多读两张表：`note_list`（便利贴）与 `todo_list`（待办）。
 *      这两条**只读**、入参不带写面，0.12.1 末随区间视图一起加入 ACL 白名单。
 *
 * 口径说明（与历史页单日视图保持一致，别在两处各写一套）：
 *   · 记录只按 `startedAt` 归区间，秒数直接用 `accumulatedSec`；
 *   · 便利贴/待办**不在 SQL 里筛**：宿主的 `note_list` 没有时间参数，
 *     `todo_list` 的 `from/to` 作用于 `plannedAt` 而不是「完成时刻」，
 *     两张表量都小，全量取回后在前端按 `createdAt` / `doneAt` 归区间。
 */
const RECORD_PAGE_LIMIT = 100;
/** 30 天 × 每天 100 条以上的极端情况：2000 条后放弃翻页，避免把库拖住 */
const RECORD_MAX_PAGES = 20;

interface RawRecord {
  itemId: number;
  accumulatedSec: number;
  startedAt: number;
}

interface RawRecordPage {
  items?: RawRecord[];
}

interface RawNote {
  id: number;
  itemId: number | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

interface RawTodo {
  id: number;
  title: string;
  plannedAt: number | null;
  doneAt: number | null;
  createdAt: number;
}

export interface HistoryRangeRecordRow {
  itemId: number;
  seconds: number;
  startedAt: number;
}

export interface HistoryRangeNoteRow {
  id: number;
  itemId: number | null;
  content: string;
  createdAt: number;
  updatedAt: number;
}

export interface HistoryRangeTodoRow {
  id: number;
  title: string;
  plannedAt: number | null;
  doneAt: number | null;
}

/** 区间内的计时记录（按 `startedAt` 落在 `[fromMs, toMs)`） */
export async function loadHistoryRangeRecords(
  fromMs: number,
  toMs: number,
): Promise<HistoryRangeRecordRow[]> {
  const rows: HistoryRangeRecordRow[] = [];
  for (let page = 1; page <= RECORD_MAX_PAGES; page += 1) {
    const result = await invoke<RawRecordPage>("list_records", {
      from: fromMs,
      to: toMs,
      page,
      limit: RECORD_PAGE_LIMIT,
    });
    const items = result.items ?? [];
    for (const item of items) {
      rows.push({
        itemId: item.itemId,
        seconds: item.accumulatedSec,
        startedAt: item.startedAt,
      });
    }
    if (items.length < RECORD_PAGE_LIMIT) break;
  }
  return rows;
}

/** 全部便利贴（含挂靠事项与独立便签）；时间归区间由调用方按 `createdAt` 做 */
export async function loadHistoryRangeNotes(): Promise<HistoryRangeNoteRow[]> {
  const rows = await invoke<RawNote[]>("note_list", {});
  return rows.map((row) => ({
    id: row.id,
    itemId: row.itemId,
    content: row.content,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  }));
}

/** 全部待办（含已完成）；完成时刻归区间由调用方按 `doneAt` 做 */
export async function loadHistoryRangeTodos(): Promise<HistoryRangeTodoRow[]> {
  const rows = await invoke<RawTodo[]>("todo_list", { includeDone: true });
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    plannedAt: row.plannedAt,
    doneAt: row.doneAt,
  }));
}
