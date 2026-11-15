import type { TimingItemName, TimingRecordSlice } from "../../../platform/runtime/timingOverlapGateway.ts";

/** 历史页上的一条「同期计时」：事项名 + 时长 + 条数。 */
export interface TimingOverlapSlice {
  name: string;
  seconds: number;
  count: number;
}

export interface TimingOverlapSource {
  records: TimingRecordSlice[];
  items: TimingItemName[];
}

const DEFAULT_LIMIT = 5;

/**
 * 把区间内的计时记录聚合成「事项 → 时长」，供历史页一行展示。
 *
 * 三条取舍：
 * 1. **按 `itemId` 聚合**，同名不同 id 不合并——它们是两个事项，合并会把账算错。
 * 2. **名字查不到就丢掉这一条**（事项被硬删后无从归属）。宁可少一行，也不要显示
 *    `#17` 这种没人能读懂的编号；宿主那边的总量仍在，不丢账。
 * 3. **零秒与负秒直接跳过**：`accumulatedSec` 理论上是非负，但一条刚 `start` 就被
 *    掐掉的记录会是 0，显示「0s」只是噪音。
 */
export function buildTimingOverlap(
  source: TimingOverlapSource,
  limit = DEFAULT_LIMIT,
): TimingOverlapSlice[] {
  const names = new Map(source.items.map((item) => [item.id, item.name]));
  const acc = new Map<number, { seconds: number; count: number }>();

  for (const record of source.records) {
    if (!names.has(record.itemId) || record.seconds <= 0) continue;
    const prev = acc.get(record.itemId) ?? { seconds: 0, count: 0 };
    acc.set(record.itemId, {
      seconds: prev.seconds + record.seconds,
      count: prev.count + 1,
    });
  }

  return [...acc.entries()]
    .map(([itemId, value]) => ({
      name: names.get(itemId) ?? "",
      seconds: value.seconds,
      count: value.count,
    }))
    /* 时长降序；同长按时长相等的情况用名字定序，避免每次渲染顺序跳动。 */
    .sort((a, b) => b.seconds - a.seconds || a.name.localeCompare(b.name))
    .slice(0, limit);
}
