/**
 * 双层时间轴的数据源：今日「事项 → 子记录」。
 *
 * ## 为什么单独一个 hook 而不是塞进 `useTodayItems`
 *
 * 两者在**失败时该怎样**上不同：
 *   · `useTodayItems` 是那张卡的主数据源，它失败 = 卡片进错误态；
 *   · 子记录是**附加信息**，失败只该让第二层消失，不能把整张卡打红
 *     （后端那条命令要跨库投影，比纯读更容易失败）。
 *
 * ## 为什么按 `itemId` 建索引，而不是直接用 `itemUid`
 *
 * 上层的行来自 `useTodayItems`（键是数字 `itemId`），下层的行来自 `focus_blocks`
 * （键是 `itemUid = i:<device>:<id>`）。两层来自两个库，只能用 uid 里的 id 对齐。
 * 这个解析**只能有一处**（`itemIdFromUid`）：写两份就会出现「一层能对上、一层对不上」，
 * 而界面上表现为「点开是空的」，没有任何报错。
 */
import { useCallback, useEffect, useState } from "react";

import {
  getItemTimeline,
  type ItemTimelineRow,
} from "../../../platform/persistence/attributionGateway.ts";
import { startOfLocalDay } from "../../../shared/lib/localDate.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

/** 子记录刷新间隔：比主数据慢一档 —— 它只在上一轮计时结束后才可能变。 */
const CHILD_REFRESH_MS = 60_000;

export interface ItemTimelineState {
  byItemId: Map<number, ItemTimelineRow>;
  status: LoadStatus;
  retry: () => void;
}

/**
 * `i:<device_id>:<id>` → `id`。
 *
 * 格式由 `data/sql/0011_*.sql` 的触发器固定（`'i:' || device_id || ':' || id`），
 * `device_id` 是 12 位小写 hex，不含冒号 —— 所以取最后一段是安全的。
 * 认不出来返回 `null`（老数据 `uid` 为 NULL 的行不会进 `focus_blocks`，
 * 但这里仍不抛：一条坏行不该让整个第二层消失）。
 */
export function itemIdFromUid(uid: string): number | null {
  const parts = uid.split(":");
  if (parts.length < 3 || parts[0] !== "i") return null;
  const id = Number(parts[parts.length - 1]);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** 把一轮取数结果折成 `itemId → 行`（纯函数，导出是为了能单测）。 */
export function indexByItemId(rows: readonly ItemTimelineRow[]): Map<number, ItemTimelineRow> {
  const map = new Map<number, ItemTimelineRow>();
  for (const row of rows) {
    const itemId = itemIdFromUid(row.itemUid);
    if (itemId === null) continue;
    map.set(itemId, row);
  }
  return map;
}

export function useItemTimeline(): ItemTimelineState {
  const [byItemId, setByItemId] = useState<Map<number, ItemTimelineRow>>(() => new Map());
  const [status, setStatus] = useState<LoadStatus>("loading");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      /* 日界用本地 00:00（`startOfLocalDay` 收 Date 返回 Date）：用 `toISOString`
         折日界会让 UTC+8 的「今天」从 08:00 开始算，早上那段凭空消失。 */
      const now = Date.now();
      const from = startOfLocalDay(new Date(now)).getTime();
      try {
        const rows = await getItemTimeline(from, now);
        if (cancelled) return;
        setByItemId(indexByItemId(rows));
        setStatus("ready");
      } catch (error) {
        if (cancelled) return;
        /* 主数据源正常时**不**翻成 error：第二层拿不到就只是没有第二层。 */
        console.warn("load item timeline failed", error);
        setStatus((current) => (current === "ready" ? current : "error"));
      }
    };

    void load();
    const timer = window.setInterval(() => {
      void load();
    }, CHILD_REFRESH_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [attempt]);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);
  return { byItemId, status, retry };
}
