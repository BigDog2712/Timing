import { describe, expect, it } from "vitest";

import {
  accumulateHeatmap,
  buildHeatmapPlan,
  emptyHeatmapModel,
  heatmapLevel,
  HEATMAP_BUCKETS,
  peakHeatmapDay,
} from "./heatmapDays.ts";

/**
 * 热力图的**静默错误**全在这一层：颜色浅一档、时段算错一格、今天未来的时段被当成
 * 零活动 —— 全都不报错、不崩、照常渲染，只是说的不是真话。所以判据钉这几件：
 *   ① 边界首尾与递增（后端校验不过 → 整条读取失败，前端只看到"没数据"）；
 *   ② 一个月一页：日期轴整月铺满，取数只到"此刻"，过去的月份是整月；
 *   ③ 6 个四小时段切开墙钟（跨段的两半各归各格）；
 *   ④ 今天/未来的时段与未来的天进 `futureBuckets`，不进格值与合计；
 *   ⑤ 色阶按 sqrt 分 5 档（线性映射会让满屏都停在第 1 档）。
 */
const HOUR = 3600_000;
/** 2026-11-12 周四 14:30（本地）：当前月 12 天、今天到第 4 段 */
const NOW = new Date(2026, 10, 12, 14, 30, 0, 0).getTime();
const NOV_START = new Date(2026, 10, 1).getTime();
const OCT_START = new Date(2026, 9, 1).getTime();

describe("buildHeatmapPlan", () => {
  it("hm01_the_current_month_shows_every_day_but_reads_only_up_to_now", () => {
    const plan = buildHeatmapPlan(NOW);
    expect(plan.monthStartMs).toBe(NOV_START);
    expect(plan.startMs).toBe(NOV_START);
    expect(plan.endMs).toBe(NOW);
    /* 日期轴整月铺满：11 月 30 天，一天不少（今天之后也只差数据，不差列） */
    expect(plan.days).toHaveLength(30);
    expect(plan.days[0].key).toBe("2026-11-01");
    expect(plan.days.at(-1)!.key).toBe("2026-11-30");
    expect(plan.days.at(-1)!.startMs).toBeGreaterThan(NOW);
    expect(plan.boundaries[0]).toBe(plan.startMs);
    expect(plan.boundaries.at(-1)).toBe(plan.endMs);
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
    /* 边界 = 格子数 + 1：后端 `validate_aggregate_boundaries` 能吃下的形状 */
    expect(plan.boundaries.length).toBe(plan.cells.length + 1);
    /* 格子只铺到此刻：1–11 日整天 + 12 日 4 段 = 70 格 */
    expect(plan.cells).toHaveLength(11 * HEATMAP_BUCKETS + 4);
  });

  it("hm02_a_past_month_is_a_full_month_of_six_buckets_per_day", () => {
    const plan = buildHeatmapPlan(NOW, 1);
    expect(plan.monthStartMs).toBe(OCT_START);
    expect(plan.days).toHaveLength(31);
    expect(plan.cells).toHaveLength(31 * HEATMAP_BUCKETS);
    expect(plan.endMs).toBe(NOV_START);
    /* 整月没有"未来"格：最后一天的第 6 段也在范围内 */
    expect(plan.cells.at(-1)!.endMs).toBe(NOV_START);
  });

  it("hm03_today_only_builds_buckets_that_have_started", () => {
    const plan = buildHeatmapPlan(NOW);
    const today = plan.days[11]; // 11-12
    const todayCells = plan.cells.filter((cell) => cell.dayIndex === 11);
    /* 14:30 → 0–4 / 4–8 / 8–12 / 12–16 四段已开始；16 点以后还没到 */
    expect(todayCells.map((cell) => cell.bucket)).toEqual([0, 1, 2, 3]);
    /* 当前段裁到此刻：12–16 段的右端是 14:30，不是 16:00 */
    expect(todayCells.at(-1)!.endMs).toBe(NOW);
    expect(todayCells.at(-1)!.startMs).toBe(today.startMs + 12 * HOUR);
  });
});

describe("accumulateHeatmap", () => {
  it("hm04_a_record_lands_in_its_four_hour_bucket_and_in_the_day_total", () => {
    const plan = buildHeatmapPlan(NOW);
    const day = plan.days[4]; // 11-05
    const model = accumulateHeatmap(plan, [
      { startTime: day.startMs + 9 * HOUR, endTime: day.startMs + 10 * HOUR },
    ]);
    expect(model.days[4].buckets[2]).toBe(HOUR);
    expect(model.days[4].buckets[1]).toBe(0);
    expect(model.days[4].buckets[3]).toBe(0);
    expect(model.days[4].totalMs).toBe(HOUR);
    expect(model.days[3].totalMs).toBe(0);
    expect(model.monthTotalMs).toBe(HOUR);
    expect(model.bucketMaxMs).toBe(HOUR);
    expect(model.totalMaxMs).toBe(HOUR);
  });

  it("hm05_sessions_are_split_at_bucket_boundaries", () => {
    const plan = buildHeatmapPlan(NOW);
    const day = plan.days[2]; // 11-03
    const model = accumulateHeatmap(plan, [
      { startTime: day.startMs + 3 * HOUR + 30 * 60_000, endTime: day.startMs + 4 * HOUR + 30 * 60_000 },
    ]);
    /* 03:30–04:30 跨了 0–4 / 4–8 两段，各 30 分钟 */
    expect(model.days[2].buckets[0]).toBe(30 * 60_000);
    expect(model.days[2].buckets[1]).toBe(30 * 60_000);
    expect(model.days[2].totalMs).toBe(HOUR);
  });

  it("hm06_todays_future_buckets_are_marked_and_never_counted", () => {
    const plan = buildHeatmapPlan(NOW);
    const today = plan.days[11]; // 11-12
    const model = accumulateHeatmap(plan, [
      /* 13:00–15:00 被"此刻"裁到 14:30 */
      { startTime: today.startMs + 13 * HOUR, endTime: today.startMs + 15 * HOUR },
    ]);
    const row = model.days[11];
    expect(row.futureBuckets).toEqual([4, 5]);
    expect(row.buckets[3]).toBe(1.5 * HOUR);
    /* 未来段的格值就是 0，渲染层靠 `futureBuckets` 画虚线 */
    expect(row.buckets[4]).toBe(0);
    expect(row.buckets[5]).toBe(0);
    /* 未来的天：6 段全在 `futureBuckets`，且一格数据都没有 */
    const future = model.days.at(-1)!;
    expect(future.futureBuckets).toEqual([0, 1, 2, 3, 4, 5]);
    expect(future.totalMs).toBe(0);
  });

  it("hm07_records_outside_the_month_are_clipped_and_empty_model_stays_all_zero", () => {
    const plan = buildHeatmapPlan(NOW);
    const model = accumulateHeatmap(plan, [
      { startTime: NOV_START - 5 * HOUR, endTime: NOV_START + HOUR },
      { startTime: NOW + HOUR, endTime: NOW + 2 * HOUR },
      { startTime: NOW, endTime: NOW },
    ]);
    expect(model.days[0].buckets[0]).toBe(HOUR);
    expect(model.monthTotalMs).toBe(HOUR);

    const empty = emptyHeatmapModel();
    expect(empty.days).toHaveLength(0);
    expect(empty.monthTotalMs).toBe(0);
    expect(peakHeatmapDay(empty)).toBeNull();
  });

  it("hm08_peak_points_at_the_busiest_day", () => {
    const plan = buildHeatmapPlan(NOW);
    const model = accumulateHeatmap(plan, [
      { startTime: plan.days[1].startMs + 9 * HOUR, endTime: plan.days[1].startMs + 10 * HOUR },
      { startTime: plan.days[2].startMs + 9 * HOUR, endTime: plan.days[2].startMs + 12 * HOUR },
    ]);
    expect(peakHeatmapDay(model)?.day.key).toBe("2026-11-03");
    expect(peakHeatmapDay(model)?.ms).toBe(3 * HOUR);
  });

  it("hm09_a_month_with_dst_still_tiles_the_timeline", () => {
    /* 3 月底 / 10 月底可能切夏令时：相邻两天的边界必须首尾相接（不重不漏） */
    const march = new Date(2026, 2, 15, 12).getTime();
    const plan = buildHeatmapPlan(march);
    for (let index = 1; index < plan.days.length; index += 1) {
      expect(plan.days[index].startMs).toBe(plan.days[index - 1].endMs);
    }
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
    expect(plan.boundaries.at(-1)).toBe(plan.endMs);
  });
});

describe("heatmapLevel", () => {
  it("hm10_levels_use_a_square_root_ramp_so_the_long_tail_stays_visible", () => {
    const max = 4 * HOUR;
    expect(heatmapLevel(0, max)).toBe(0);
    expect(heatmapLevel(-1, max)).toBe(0);
    expect(heatmapLevel(HOUR, 0)).toBe(0);
    /* 峰值那一格吃满 */
    expect(heatmapLevel(max, max)).toBe(5);
    /* 1/25 的峰值 → sqrt = 0.2 → 第 1 档；线性映射会直接掉到 0 */
    expect(heatmapLevel(max / 25, max)).toBe(1);
    const ramp = [1, 4, 9, 16, 25].map((factor) => heatmapLevel(max / factor, max));
    expect(ramp).toEqual([...ramp].sort((a, b) => b - a));
    expect(new Set(ramp).size).toBeGreaterThan(2);
  });
});