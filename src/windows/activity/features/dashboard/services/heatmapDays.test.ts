import { describe, expect, it } from "vitest";

import {
  accumulateHeatmap,
  buildHeatmapPlan,
  emptyHeatmapModel,
  heatmapLevel,
  HEATMAP_HOURS,
  HEATMAP_ROWS,
  HEATMAP_WEEKS,
  mondayIndex,
  peakHeatmapCell,
} from "./heatmapDays.ts";

/**
 * 热力图的**静默错误**全在这一层：颜色浅一档、平均分母算错、行错一个星期几 ——
 * 全都不报错、不崩、照常渲染，只是说的不是真话。所以判据钉这五件：
 *   ① 边界首尾与递增（后端校验不过 → 整条读取失败，前端只看到"没数据"）；
 *   ② 行 = 周一→周日，且 28 天窗口里每个星期几正好 4 个样本；
 *   ③ 平均的**分母是有样本的次数**，今天的未来小时不进分母；
 *   ④ 墙钟分摊（跨小时、跨午夜都要切开）；
 *   ⑤ 色阶按 sqrt 分 5 档（线性映射会让满屏都停在第 1 档）。
 */
const HOUR = 3600_000;
/** 2026-11-12 是周四（下面多条判据用到这个事实） */
const NOW = new Date(2026, 10, 12, 14, 30, 0, 0).getTime();

describe("buildHeatmapPlan", () => {
  it("hm01_four_weeks_of_days_and_boundaries_that_start_and_end_at_the_range", () => {
    const plan = buildHeatmapPlan(NOW);
    expect(plan.days).toHaveLength(HEATMAP_WEEKS * HEATMAP_ROWS);
    expect(plan.boundaries[0]).toBe(plan.startMs);
    expect(plan.boundaries.at(-1)).toBe(plan.endMs);
    expect(plan.endMs).toBe(NOW);
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
    /* 边界 = 格子数 + 1：后端 `validate_aggregate_boundaries` 能吃下的形状 */
    expect(plan.boundaries.length).toBe(plan.cells.length + 1);
  });

  it("hm02_rows_are_monday_first_and_each_weekday_has_four_samples", () => {
    const plan = buildHeatmapPlan(NOW);
    const last = plan.days.at(-1)!;
    /* 今天（周四）= 索引 3，不是 JS 的 4 */
    expect(last.weekday).toBe(3);
    expect(mondayIndex(new Date(2026, 10, 8))).toBe(6); // 周日
    expect(mondayIndex(new Date(2026, 10, 9))).toBe(0); // 周一

    const model = accumulateHeatmap(plan, []);
    const counts = new Map<number, number>();
    for (const cell of plan.cells) counts.set(cell.weekday, (counts.get(cell.weekday) ?? 0) + 1);
    /* 每个星期几 24 格 × 4 周；今天的傍晚还没发生，所以周四少几格 */
    for (let weekday = 0; weekday < HEATMAP_ROWS; weekday += 1) {
      const expected = weekday === 3 ? HEATMAP_HOURS * 4 - 9 : HEATMAP_HOURS * 4;
      expect(counts.get(weekday)).toBe(expected);
    }
    expect(model.rows.map((row) => row.weekday)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });
});

describe("accumulateHeatmap", () => {
  it("hm03_average_divides_by_the_number_of_samples_for_that_weekday_and_hour", () => {
    const plan = buildHeatmapPlan(NOW);
    /* 上周四 9:00–10:00：4 个周四样本 → 平均 15 分钟 */
    const lastThursday = plan.days.at(-1)!;
    const start = lastThursday.startMs - 7 * 24 * HOUR + 9 * HOUR;
    const model = accumulateHeatmap(plan, [{ startTime: start, endTime: start + HOUR }]);

    expect(model.rows[3].cells[9]).toBe(HOUR / 4);
    /* 别的小时、别的行一格都不许沾 */
    expect(model.rows[3].cells[10]).toBe(0);
    expect(model.rows[2].cells[9]).toBe(0);
    expect(model.weeklyTotalMs).toBe(HOUR / 4);
  });

  it("hm04_todays_future_hours_are_not_in_the_denominator", () => {
    const plan = buildHeatmapPlan(NOW);
    const lastThursday = plan.days.at(-1)!;
    /* 20 点今天还没到 → 只有 3 个样本；拿 4 去平均会让整行傍晚凭空变淡 */
    const start = lastThursday.startMs - 7 * 24 * HOUR + 20 * HOUR;
    const model = accumulateHeatmap(plan, [{ startTime: start, endTime: start + HOUR }]);
    expect(model.rows[3].cells[20]).toBe(HOUR / 3);
  });

  it("hm05_sessions_are_split_by_wall_clock_across_hours_and_midnight", () => {
    const plan = buildHeatmapPlan(NOW);
    const thursday = plan.days.at(-1)!;
    const wednesdayLate = thursday.startMs - 30 * 60_000;
    const model = accumulateHeatmap(plan, [{
      startTime: wednesdayLate,
      endTime: thursday.startMs + 30 * 60_000,
    }]);
    /* 周三 23:30–24:00 与周四 00:00–00:30 各 30 分钟，各自除以自己的样本数（4） */
    expect(model.rows[2].cells[23]).toBe((30 * 60_000) / 4);
    expect(model.rows[3].cells[0]).toBe((30 * 60_000) / 4);
  });

  it("hm06_records_outside_the_range_are_clipped_and_empty_model_stays_all_zero", () => {
    const plan = buildHeatmapPlan(NOW);
    const model = accumulateHeatmap(plan, [
      { startTime: plan.startMs - 5 * HOUR, endTime: plan.startMs + HOUR },
      { startTime: NOW + HOUR, endTime: NOW + 2 * HOUR },
      { startTime: NOW, endTime: NOW },
    ]);
    expect(model.weeklyTotalMs).toBe(HOUR / 4);
    expect(model.rows.every((row) => row.cells.every((value) => value === 0))).toBe(false);

    const empty = emptyHeatmapModel();
    expect(empty.maxMs).toBe(0);
    expect(empty.rows).toHaveLength(HEATMAP_ROWS);
    expect(peakHeatmapCell(empty)).toBeNull();
  });
});

describe("heatmapLevel / peakHeatmapCell", () => {
  it("hm07_levels_use_a_square_root_ramp_so_the_long_tail_stays_visible", () => {
    const max = 60 * 60_000;
    expect(heatmapLevel(0, max)).toBe(0);
    expect(heatmapLevel(-1, max)).toBe(0);
    expect(heatmapLevel(HOUR, 0)).toBe(0);
    /* 峰值那一格吃满 */
    expect(heatmapLevel(max, max)).toBe(5);
    /* 1/25 的峰值 → sqrt = 0.2 → 第 1 档；线性映射会直接掉到 0 */
    expect(heatmapLevel(max / 25, max)).toBe(1);
    /* 单调不增：值越大档位越深（同档可以并列，比如 1/9 与 1/16 都在第 2 档） */
    const ramp = [1, 4, 9, 16, 25].map((factor) => heatmapLevel(max / factor, max));
    expect(ramp).toEqual([...ramp].sort((a, b) => b - a));
    expect(new Set(ramp).size).toBeGreaterThan(2);
  });

  it("hm08_peak_points_at_the_busiest_cell", () => {
    const plan = buildHeatmapPlan(NOW);
    const thursday = plan.days.at(-1)!;
    const model = accumulateHeatmap(plan, [
      { startTime: thursday.startMs + 9 * HOUR, endTime: thursday.startMs + 10 * HOUR },
      { startTime: thursday.startMs + 11 * HOUR, endTime: thursday.startMs + 11 * HOUR + 10 * 60_000 },
    ]);
    expect(peakHeatmapCell(model)).toEqual({ weekday: 3, hour: 9, ms: HOUR / 4 });
  });
});
