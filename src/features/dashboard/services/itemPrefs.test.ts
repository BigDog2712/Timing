import { describe, expect, it } from "vitest";

import {
  clampItemMinutes,
  clampRecentCount,
  itemTimerMinutes,
  ITEM_TIMER_MAX_MINUTES,
  ITEM_TIMER_MIN_MINUTES,
  moveItem,
  nextSortOrder,
  normalizeItemTimers,
  pinnedItems,
  recentItems,
  RECENT_ITEMS_DEFAULT,
  RECENT_ITEMS_MAX,
  RECENT_ITEMS_MIN,
  withItemTimer,
  type ItemPrefsLike,
  type ItemTimers,
} from "./itemPrefs.ts";

/**
 * 「事项管理」纯函数层的**行为判据**（[本轮]）。
 *
 * 这些函数是镜像宿主 `src/lib/commonItems.ts` / `src/lib/moyu.ts` 的那一份（L9 禁 import），
 * 所以每一条都钉「宿主那句话到底是什么意思」，而不是钉某个实现的写法：
 *   · 变的是常量漂移（那条在 `itemPrefs.mirror.test.ts`）与边界口径（这里）。
 */

function item(over: Partial<ItemPrefsLike> & { id: number }): ItemPrefsLike {
  return {
    name: `事项${over.id}`,
    isSystem: false,
    isPinned: false,
    sortOrder: 0,
    updatedAt: 0,
    ...over,
  };
}

describe("itemPrefs · 默认时长", () => {
  it("ip01_normalize_drops_dirty_ids_and_out_of_range_values", () => {
    const raw: ItemTimers = {
      "1": 25,
      "2": 0,          // 小于下限 → 丢
      "3": 2000,       // 大于上限 → 丢
      "0": 30,         // id 非法 → 丢
      "-4": 10,        // id 非法 → 丢
      abc: 12,         // 键不是数字 → 丢
      "5": 7.6,        // 取整 → 保留 8
    };
    expect(normalizeItemTimers(raw)).toEqual({ "1": 25, "5": 8 });
    expect(normalizeItemTimers(null)).toEqual({});
  });

  it("ip02_withItemTimer_sets_and_clears", () => {
    const set = withItemTimer({}, 7, 25);
    expect(itemTimerMinutes(set, 7)).toBe(25);
    /* `null` 不是「设为 0」，是**删掉这个键** = 回到正计时 */
    const cleared = withItemTimer(set, 7, null);
    expect(cleared).toEqual({});
    expect(itemTimerMinutes(cleared, 7)).toBeNull();
    /* 清除不碰别的事项 */
    expect(withItemTimer({ "1": 5, "7": 25 }, 7, null)).toEqual({ "1": 5 });
  });

  it("ip03_clampItemMinutes_blank_and_nan_are_null_and_out_of_range_is_clamped", () => {
    expect(clampItemMinutes("")).toBeNull();
    expect(clampItemMinutes("   ")).toBeNull();
    expect(clampItemMinutes(null)).toBeNull();
    expect(clampItemMinutes(undefined)).toBeNull();
    expect(clampItemMinutes("abc")).toBeNull();
    expect(clampItemMinutes(Number.NaN)).toBeNull();
    expect(clampItemMinutes(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampItemMinutes(0)).toBe(ITEM_TIMER_MIN_MINUTES);
    expect(clampItemMinutes("0")).toBe(ITEM_TIMER_MIN_MINUTES);
    expect(clampItemMinutes(2000)).toBe(ITEM_TIMER_MAX_MINUTES);
    expect(clampItemMinutes("12.4")).toBe(12);
    expect(clampItemMinutes(" 25 ")).toBe(25);
  });

  it("ip04_clampRecentCount_is_1_to_10_and_falls_back_to_5", () => {
    expect(clampRecentCount(0)).toBe(RECENT_ITEMS_MIN);
    expect(clampRecentCount(99)).toBe(RECENT_ITEMS_MAX);
    expect(clampRecentCount(Number.NaN)).toBe(RECENT_ITEMS_DEFAULT);
    expect(clampRecentCount(7)).toBe(7);
  });
});

describe("itemPrefs · 分组", () => {
  it("ip05_pinnedItems_excludes_system_items_and_sorts_by_sortOrder_then_id", () => {
    const list = [
      item({ id: 4, isPinned: true, sortOrder: 3 }),
      item({ id: 1, isPinned: true, sortOrder: 0, isSystem: true }), // 系统事项即便置顶也不列
      item({ id: 9, isPinned: false }),
      item({ id: 3, isPinned: true, sortOrder: 3 }), // 同权重 → id 升序
      item({ id: 2, isPinned: true, sortOrder: 1 }),
    ];
    expect(pinnedItems(list).map((row) => row.id)).toEqual([2, 3, 4]);
  });

  it("ip06_recentItems_excludes_pinned_and_system_then_takes_the_newest_N", () => {
    const list = [
      item({ id: 1, updatedAt: 100 }),
      item({ id: 2, updatedAt: 900 }),
      item({ id: 3, updatedAt: 500, isPinned: true }),
      item({ id: 4, updatedAt: 700, isSystem: true }),
      item({ id: 5, updatedAt: 300 }),
      item({ id: 6, updatedAt: 800 }),
    ];
    /* 倒序：2(900) → 6(800) → 5(300) → 1(100) */
    expect(recentItems(list, 2).map((row) => row.id)).toEqual([2, 6]);
    expect(recentItems(list, RECENT_ITEMS_DEFAULT).map((row) => row.id)).toEqual([2, 6, 5, 1]);
    /* 条数脏值也要被钳住，不能把整张表倒出来 */
    expect(recentItems(list, 99)).toHaveLength(4);
  });

  it("ip07_nextSortOrder_is_max_plus_one", () => {
    expect(nextSortOrder([])).toBe(1);
    expect(nextSortOrder([item({ id: 1, sortOrder: 4 }), item({ id: 2, sortOrder: 9 })])).toBe(10);
  });
});

describe("itemPrefs · 上移下移", () => {
  it("ip08_moveItem_moves_one_step_and_keeps_the_rest", () => {
    expect(moveItem(["a", "b", "c"], 0, 1)).toEqual(["b", "a", "c"]);
    expect(moveItem(["a", "b", "c"], 2, 1)).toEqual(["a", "c", "b"]);
  });

  it("ip09_moveItem_out_of_range_or_same_position_returns_a_copy_unchanged", () => {
    const source = ["a", "b", "c"];
    for (const [from, to] of [[1, 1], [-1, 0], [0, 9], [3, 0]] as const) {
      const next = moveItem(source, from, to);
      expect(next).toEqual(source);
      expect(next).not.toBe(source);
    }
  });
});
