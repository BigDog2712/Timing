import { useCallback, useEffect, useMemo, useState } from "react";

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
        setRows(buildTodayItemRows(items, records, start, end));
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

  const total = useMemo(() => rows.reduce((sum, row) => sum + row.value, 0), [rows]);
  return { rows, status, total, retry };
}
