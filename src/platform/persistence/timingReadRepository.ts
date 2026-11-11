import { invokeWithCommandError } from "./commandError.ts";

/**
 * 分析窗读「Timing 自己的事项与计时记录」的只读网关（P2/P3 修正 · 0.12.1）。
 *
 * 为什么要有它：之前「事项分布」「事项菜单」误用了 `CompiledSession.displayTitle`
 * ——那是**应用窗口标题**（Patina 的活动采集），不是用户在悬浮条里建的事项。
 * 主人口径（2026-11-11）：「事项菜单和事项分布显示的是悬浮窗内的事项，而非应用的」。
 *
 * 三条边界（与 `noteReadRepository.ts` 同一套纪律）：
 *   1. 不能 import 主窗的 `src/services/api.ts` / `src/types/domain/...`（L9 双窗隔离）。
 *   2. 本目录出现 `invokeWithCommandError` 是合法的（L1 组件规则不覆盖 persistence）。
 *   3. 命令名 snake_case、入参 camelCase；ACL 由 `permissions/patina-host-data.toml` 放行两条只读命令。
 *
 * 只读：创建/改名/删除一律走 `patina:host-intent` 事件桥，药丸侧执行 —— 不扩大这扇门。
 */

export interface TimingItem {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
}

export interface TimingRecord {
  id: number;
  itemId: number;
  startedAt: number;
  endedAt: number | null;
  /** 已累计秒数（进行中 = 到上次落盘的累计；渲染时不再自己推算） */
  accumulatedSec: number;
  status: string;
}

export async function listTimingItems(): Promise<TimingItem[]> {
  const rows = await invokeWithCommandError<unknown>("list_items", { includeArchived: false });
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row): TimingItem[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    const name = typeof record.name === "string" ? record.name.trim() : "";
    if (!Number.isSafeInteger(id) || name.length === 0) return [];
    return [{
      id,
      name,
      color: typeof record.color === "string" ? record.color : "",
      isSystem: record.isSystem === true,
    }];
  });
}

/**
 * 取一段区间内的计时记录。
 *
 * `list_records` 的分页上限由调用方给（这里取 200，一天的量级远小于它）；
 * 返回结构兼容 `{ items: [...] }` 与裸数组两种形态 —— 命令在 0.11.x 有过一次包层调整，
 * 两种都认比「按某版实现写死」安全。
 */
export async function listTimingRecords(from: number, to: number, limit = 200): Promise<TimingRecord[]> {
  const payload = await invokeWithCommandError<unknown>("list_records", { from, to, page: 1, limit });
  const rows = Array.isArray(payload)
    ? payload
    : (payload && typeof payload === "object" && Array.isArray((payload as { items?: unknown }).items)
      ? (payload as { items: unknown[] }).items
      : []);
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row): TimingRecord[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    const itemId = Number(record.itemId);
    const startedAt = Number(record.startedAt);
    const accumulatedSec = Number(record.accumulatedSec);
    if (!Number.isSafeInteger(id) || !Number.isSafeInteger(itemId)) return [];
    if (!Number.isFinite(startedAt)) return [];
    const endedAt = typeof record.endedAt === "number" && Number.isFinite(record.endedAt)
      ? record.endedAt
      : null;
    return [{
      id,
      itemId,
      startedAt,
      endedAt,
      accumulatedSec: Number.isFinite(accumulatedSec) ? Math.max(0, accumulatedSec) : 0,
      status: typeof record.status === "string" ? record.status : "saved",
    }];
  });
}
