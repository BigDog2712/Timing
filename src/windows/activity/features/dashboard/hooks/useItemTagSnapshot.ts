/**
 * 事项标签的读侧：候选（定义 ∪ 已用）与某事项当前标签。
 *
 * 两个弹层（新建 / 编辑）都要这份数据，但都不该为它把读失败打成整卡错误：
 * 读不到时退化成「只能手输新标签」，名称 / 时长 / 分类照常可编辑。
 */
import { useEffect, useState } from "react";

import { listTagDefinitions } from "../../../platform/persistence/tagAdminGateway.ts";
import { listTimingItemTags } from "../../../platform/persistence/timingReadRepository.ts";

export interface ItemTagSnapshot {
  options: string[];
  byItem: ReadonlyMap<number, string[]>;
}

const EMPTY: ItemTagSnapshot = { options: [], byItem: new Map() };

export function useItemTagSnapshot(enabled: boolean): ItemTagSnapshot {
  const [snapshot, setSnapshot] = useState<ItemTagSnapshot>(EMPTY);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    void (async () => {
      const [definitions, rows] = await Promise.allSettled([
        listTagDefinitions(),
        listTimingItemTags(),
      ]);
      if (cancelled) return;
      const byItem = new Map<number, string[]>();
      const all = new Set<string>();
      if (definitions.status === "fulfilled") {
        for (const path of definitions.value) all.add(path);
      }
      if (rows.status === "fulfilled") {
        for (const row of rows.value) {
          byItem.set(row.itemId, row.tags);
          for (const tag of row.tags) all.add(tag);
        }
      }
      setSnapshot({
        byItem,
        options: [...all].sort((left, right) => left.localeCompare(right, "zh-CN")),
      });
    })().catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return snapshot;
}
