import { describe, expect, it } from "vitest";

import {
  buildHistoryRangeBucketBoundaries,
  resolveHistoryDayRange,
  resolveHistoryRange,
  type HistoryRangeLabels,
} from "./historyRange.ts";

/**
 * 区间档位的边界判据。
 *
 * 全部用**显式 nowMs**（2026-11-11 15:30，周三），不读系统时间：
 * 周五/周一的差异、"本周"跨月与否，都是这一层最容易算错又最难在界面看出来的地方。
 */
const NOW = new Date(2026, 10, 11, 15, 30, 0).getTime();
const TODAY_START = new Date(2026, 10, 11, 0, 0, 0, 0).getTime();

const LABELS: HistoryRangeLabels = {
  yesterday: "昨日",
  thisWeek: "本周",
  last7: "近 7 天",
  last30: "近 30 天",
  customRange: (start, end, days) => `${start} ~ ${end} · ${days} 天`,
};

const keyOf = (year: number, month: number, day: number) => (
  `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
);

describe("resolveHistoryRange · 档位边界", () => {
  it("r01_day_mode_returns_null", () => {
    /* 单日视图有自己的日快照，区间层不许替它编一个窗口出来 */
    expect(resolveHistoryRange("day", null, NOW, LABELS)).toBeNull();
  });

  it("r02_yesterday_ends_at_today_start_not_at_now", () => {
    /* 关键差异：其他档位的右端都是"此刻"，只有昨日是"今日 00:00"。
       写成 min(次日, now) 会把今天 15:30 之前的记录也算进"昨日"——变异：把
       `addLocalDays(today,-1)` 换成 `today` → 本条与 r03 同时红 */
    const range = resolveHistoryRange("yesterday", null, NOW, LABELS);
    expect(range).not.toBeNull();
    expect(range?.startDateKey).toBe(keyOf(2026, 11, 10));
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 10));
    expect(range?.startMs).toBe(new Date(2026, 10, 10).getTime());
    expect(range?.endMs).toBe(TODAY_START);
    expect(range?.dayCount).toBe(1);
    expect(range?.label).toBe("昨日");
  });

  it("r03_this_week_starts_on_monday_and_ends_at_now", () => {
    /* 2026-11-11 是周三 → 本周一 = 11-09。ISO 周（周一起）与数据页「周」档同一条线。 */
    const range = resolveHistoryRange("week", null, NOW, LABELS);
    expect(range?.startDateKey).toBe(keyOf(2026, 11, 9));
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 11));
    expect(range?.dayCount).toBe(3);
    expect(range?.endMs).toBe(NOW);
    expect(range?.label).toBe("本周");
  });

  it("r04_this_week_survives_a_month_boundary", () => {
    /* 2026-11-01 是周日 → 那一周从 10-26 开始。跨月不跨月由 `addLocalDays` 负责，
       但档位一旦改用 `setDate(1)` 之类的写法就会在月初突变。 */
    const sunday = new Date(2026, 10, 1, 9, 0, 0).getTime();
    const range = resolveHistoryRange("week", null, sunday, LABELS);
    expect(range?.startDateKey).toBe(keyOf(2026, 10, 26));
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 1));
    expect(range?.dayCount).toBe(7);
  });

  it("r05_last7_covers_seven_days_including_today", () => {
    const range = resolveHistoryRange("last7", null, NOW, LABELS);
    expect(range?.startDateKey).toBe(keyOf(2026, 11, 5));
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 11));
    expect(range?.dayCount).toBe(7);
    expect(range?.endMs).toBe(NOW);
  });

  it("r06_last30_covers_thirty_days_including_today", () => {
    const range = resolveHistoryRange("last30", null, NOW, LABELS);
    expect(range?.startDateKey).toBe(keyOf(2026, 10, 13));
    expect(range?.dayCount).toBe(30);
    expect(range?.days).toHaveLength(30);
  });

  it("r07_days_are_contiguous_and_the_last_one_is_clipped_to_end_ms", () => {
    /* 逐日柱、逐日桶、活动聚合的分桶边界三处都吃这个数组：
       必须首尾相接、最后一天的 endMs 必须等于区间 endMs，否则最后一天会被算两次或漏算 */
    const range = resolveHistoryRange("last7", null, NOW, LABELS);
    expect(range).not.toBeNull();
    const days = range?.days ?? [];
    expect(days[0].startMs).toBe(range?.startMs);
    expect(days[days.length - 1].endMs).toBe(range?.endMs);
    for (let index = 1; index < days.length; index += 1) {
      expect(days[index].startMs).toBe(days[index - 1].endMs);
    }
    /* 非最后一天都是整日（24h） */
    expect(days[1].startMs - days[0].startMs).toBe(24 * 60 * 60 * 1000);
  });

  it("r08_custom_reversed_selection_is_normalized", () => {
    /* 用户先点 11-08 再点 11-02 是常态；反着选不许变成负数天数 */
    const range = resolveHistoryRange(
      "custom",
      { startDateKey: keyOf(2026, 11, 8), endDateKey: keyOf(2026, 11, 2) },
      NOW,
      LABELS,
    );
    expect(range?.startDateKey).toBe(keyOf(2026, 11, 2));
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 8));
    expect(range?.dayCount).toBe(7);
    expect(range?.label).toContain("7 天");
  });

  it("r09_custom_end_is_clamped_to_today", () => {
    /* 未来日期不许进区间：右端裁到今天，endMs 仍是"此刻" */
    const range = resolveHistoryRange(
      "custom",
      { startDateKey: keyOf(2026, 11, 1), endDateKey: keyOf(2026, 11, 20) },
      NOW,
      LABELS,
    );
    expect(range?.endDateKey).toBe(keyOf(2026, 11, 11));
    expect(range?.endMs).toBe(NOW);
    expect(range?.dayCount).toBe(11);
  });

  it("r10_custom_without_bounds_returns_null", () => {
    expect(resolveHistoryRange("custom", null, NOW, LABELS)).toBeNull();
  });

  it("r11_cache_key_distinguishes_every_mode_and_window", () => {
    /* 缓存键错会让"换档不重查"或"同档反复重查"两种病同时出现 */
    const keys = [
      resolveHistoryRange("yesterday", null, NOW, LABELS)?.cacheKey,
      resolveHistoryRange("week", null, NOW, LABELS)?.cacheKey,
      resolveHistoryRange("last7", null, NOW, LABELS)?.cacheKey,
      resolveHistoryRange("last30", null, NOW, LABELS)?.cacheKey,
      resolveHistoryRange("custom", { startDateKey: keyOf(2026, 11, 2), endDateKey: keyOf(2026, 11, 8) }, NOW, LABELS)?.cacheKey,
    ];
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("r12_bucket_boundaries_start_and_end_with_the_range_edges", () => {
    /* 后端 `validate_aggregate_boundaries` 要求 first == startMs、last == endMs，
       否则整条 activity 读失败（区间里应用那四块会全空，而这里零报错） */
    const range = resolveHistoryRange("last7", null, NOW, LABELS);
    expect(range).not.toBeNull();
    if (!range) return;
    const boundaries = buildHistoryRangeBucketBoundaries(range);
    expect(boundaries[0]).toBe(range.startMs);
    expect(boundaries[boundaries.length - 1]).toBe(range.endMs);
    expect(boundaries).toHaveLength(range.days.length + 1);
    for (let index = 1; index < boundaries.length; index += 1) {
      expect(boundaries[index]).toBeGreaterThan(boundaries[index - 1]);
    }
  });
});

/**
 * 单日档（`resolveHistoryDayRange`）—— 「当日与往期格式统一」的地基。
 *
 * 单日现在等价于 `dayCount === 1` 的区间，走同一个后端聚合、同一套墙钟裁剪口径。
 * 这一组钉的是"窗口算得对"，不是"界面长得像"：窗口一旦偏一天，两边的数字就又开始对不上。
 */
describe("resolveHistoryDayRange · 单日 = 一天的区间", () => {
  it("d01_past_day_covers_the_whole_local_day", () => {
    const range = resolveHistoryDayRange(keyOf(2026, 11, 10), NOW, "2026-11-10");
    expect(range).not.toBeNull();
    if (!range) return;
    expect(range.mode).toBe("day");
    expect(range.dayCount).toBe(1);
    expect(range.startMs).toBe(new Date(2026, 10, 10, 0, 0, 0, 0).getTime());
    /* 往日是整日：右端严格等于次日 00:00，不吃"此刻"的裁剪 */
    expect(range.endMs).toBe(new Date(2026, 10, 11, 0, 0, 0, 0).getTime());
    expect(range.days).toHaveLength(1);
    expect(range.cacheKey).toBe("day:2026-11-10");
  });

  it("d02_today_is_trimmed_to_now", () => {
    /* 看今天不能把晚上还没发生的时段算进分母，否则"今天 vs 昨天"永远不公平 */
    const range = resolveHistoryDayRange(keyOf(2026, 11, 11), NOW, "今天");
    expect(range?.endMs).toBe(NOW);
    expect(range?.days[0].endMs).toBe(NOW);
  });

  it("d03_future_day_has_no_range", () => {
    expect(resolveHistoryDayRange(keyOf(2026, 11, 12), NOW, "明天")).toBeNull();
  });

  it("d04_malformed_key_has_no_range", () => {
    expect(resolveHistoryDayRange("2026-13-40", NOW, "坏日子")).toBeNull();
  });

  it("d05_bucket_boundaries_still_close_on_both_ends", () => {
    /* 单日也走后端分桶聚合，同样的首尾闭合要求；不闭合整条 activity 读失败 */
    const range = resolveHistoryDayRange(keyOf(2026, 11, 10), NOW, "2026-11-10");
    expect(range).not.toBeNull();
    if (!range) return;
    const boundaries = buildHistoryRangeBucketBoundaries(range);
    expect(boundaries).toEqual([range.startMs, range.endMs]);
  });
});
