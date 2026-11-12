import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  listTimingItems,
  listTimingRecords,
  type TimingItem,
  type TimingRecord,
} from "../../../platform/persistence/timingReadRepository.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/**
 * 「今日事项」聚合（P2 修正 · 0.12.1）：**Timing 自己的 items + time_records**，
 * 不是应用窗口标题。
 *
 * 一个事项一行：名字、今天累计、今天第一段的开始时刻、段数。按累计降序 ——
 * 「事项分布」维度要的就是占比，而「事项菜单」卡按开始时刻升序另排（同一个数组两种排序）。
 *
 * 三项都只读：`list_items` + `list_records`（ACL 见 `permissions/patina-host-data.toml`）。
 * 失败降级为空清单 + 一条 warn，不把主界面打红。
 */
export interface TodayItemRow {
  itemId: number;
  name: string;
  color: string;
  /** 今天累计毫秒 */
  value: number;
  /** 今天第一段的开始时刻（毫秒时间戳） */
  firstStart: number;
  /** 段数 */
  segments: number;
}

export interface TodayItemsState {
  rows: TodayItemRow[];
  status: LoadStatus;
  total: number;
  retry: () => void;
  /**
   * 改名**已经发出去**之后就地改这一行（[本轮]「事项管理」弹层的行内编辑）。
   *
   * 为什么不能只等下一次刷新（照 `useTodayNotes.removeLocal` 的同一个先例）：
   * 改名走的是事件桥，宿主落库有一小段延迟，刷新又是 30s 一次 —— 中间用户会看到
   * 「改完又变回去了」，然后怀疑改名没生效。所以：
   *   ① 立刻改 state 里的那行；
   *   ② 把 `id → 本地名字` 记进"待确认"表；
   *   ③ 之后每次刷新，只要返回的还是**旧名字**就用本地名字覆盖（不弹回去）；
   *   ④ 某次返回的名字与本地一致（宿主已落库）才把 id 从表里摘掉。
   * 与便利贴不同，这里**不能**只按 id 过滤：被改名的那条今天照样有记录，必须留在时间线上。
   */
  applyLocalRename: (itemId: number, name: string) => void;
  /**
   * 新建了一条事项之后调用。新事项今天还没有任何记录 → **不进时间线行**
   * （这张卡只画今天有记录的事项，是既有口径，不改），所以不做乐观插入，只重拉一次。
   * 弹层里的"刚建、宿主还没落库"那一行由 `TimelineManage` 自己维护。
   */
  applyLocalCreate: (name: string) => void;
}

export function buildTodayItemRows(
  items: readonly TimingItem[],
  records: readonly TimingRecord[],
  from: number,
  to: number,
  now = Date.now(),
): TodayItemRow[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  const buckets = new Map<number, TodayItemRow>();

  for (const record of records) {
    if (!Number.isFinite(record.startedAt)) continue;
    if (record.startedAt < from || record.startedAt >= to) continue;

    /* 进行中的记录：`accumulatedSec` 只到上次落盘，补上「自 running_since 起」的那一段，
       否则正在计时的事项会显示成 0m（看起来像丢数据）。 */
    const running = record.endedAt === null && record.status === "active";
    const liveMs = running ? Math.max(0, now - record.startedAt) : 0;
    const value = record.accumulatedSec * 1000 + liveMs;
    if (value <= 0) continue;

    const item = byId.get(record.itemId);
    const name = item?.name ?? "未归类";
    const existing = buckets.get(record.itemId);
    if (existing) {
      existing.value += value;
      existing.firstStart = Math.min(existing.firstStart, record.startedAt);
      existing.segments += 1;
    } else {
      buckets.set(record.itemId, {
        itemId: record.itemId,
        name,
        color: item?.color ?? "",
        value,
        firstStart: record.startedAt,
        segments: 1,
      });
    }
  }

  return [...buckets.values()].sort((a, b) => b.value - a.value);
}

export function useTodayItems(refreshKey: number, refreshIntervalSecs: number): TodayItemsState {
  const [rows, setRows] = useState<TodayItemRow[]>([]);
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  /* 已发出改名意图、但宿主还没落库的行：`itemId → 本地名字`。
     ref 而不是 state —— 它只用于"覆盖下一次结果"，由 `applyLocalRename` 顺带的那次
     `setRows` 触发重渲染，不需要自己再排一次刷新。 */
  const pendingRenamesRef = useRef<Map<number, string>>(new Map());

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setStatus((current) => (current === "ready" ? current : "loading"));

    const load = async () => {
      try {
        const start = startOfLocalDay(new Date()).getTime();
        const end = start + 24 * 60 * 60 * 1000;
        const [items, records] = await Promise.all([listTimingItems(), listTimingRecords(start, end)]);
        if (cancelled) return;
        const next = buildTodayItemRows(items, records, start, end);
        /* ③④「改名不被刷新覆盖」的唯一一处实现：
           · 返回的名字与本地一致 → 宿主已落库，摘掉这条待确认；
           · 返回的还是旧名字 → 用本地名字覆盖（否则用户看到"改完又变回去"）；
           · 这行今天没有记录（不在 next 里）→ 无从确认，保留待确认，下次再说。 */
        const pending = pendingRenamesRef.current;
        if (pending.size > 0) {
          for (const [itemId, localName] of Array.from(pending)) {
            const index = next.findIndex((row) => row.itemId === itemId);
            if (index < 0) continue;
            if (next[index].name === localName) {
              pending.delete(itemId);
              continue;
            }
            next[index] = { ...next[index], name: localName };
          }
        }
        setRows(next);
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        console.warn("load today items failed", error);
        setStatus((current) => (current === "ready" ? current : "error"));
      }
    };

    void load();
    /* 计时在跑时按用户设定的刷新间隔重取；没有任何计时时也保持一分钟一次，
       否则「刚结束一条记录」要等到下次切窗才看见。 */
    const timer = window.setInterval(() => {
      void load();
    }, Math.max(1, refreshIntervalSecs) * 1000);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attempt, refreshKey, refreshIntervalSecs]);

  const applyLocalRename = useCallback((itemId: number, rawName: string) => {
    const name = rawName.trim();
    if (!name) return;
    pendingRenamesRef.current.set(itemId, name);
    setRows((current) => current.map((row) => (
      row.itemId === itemId ? { ...row, name } : row
    )));
  }, []);

  const applyLocalCreate = useCallback((name: string) => {
    /* `name` 不参与本地合并（见接口注释：新事项今天没有记录，不进时间线行）——
       保留这个参数是为了让调用点的意图自解释，并给"宿主拒绝"留一个可挂日志的锚点。 */
    void name;
    setAttempt((value) => value + 1);
  }, []);

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.value, 0), [rows]);
  return { rows, status, total, retry, applyLocalRename, applyLocalCreate };
}
