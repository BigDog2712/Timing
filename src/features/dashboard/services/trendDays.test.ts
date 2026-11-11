import { describe, expect, it } from "vitest";

import { accumulateTrendDays, buildTrendQueryPlan } from "./trendDays";

/**
 * 趋势柱的几何判据。这四条钉的都是**算错了也照样出货**的地方：
 * 柱子矮一截、某一天归到前一天、最后一天分母是未来 —— 界面全都正常渲染。
 */
describe("应用趋势 · 按日切桶", () => {
  /* 2026-11-11 18:24 本地时间（东八区） */
  const now = new Date(2026, 10, 11, 18, 24, 0).getTime();

  it("t01_seven_days_end_today_and_end_at_now", () => {
    const plan = buildTrendQueryPlan(now, 7);
    expect(plan.windows).toHaveLength(7);
    expect(plan.windows[0].key).toBe("2026-11-05");
    expect(plan.windows[6].key).toBe("2026-11-11");
    /* 日界是本地 00:00，不是 UTC：UTC 切法会让首日变成 11-05 08:00 */
    expect(plan.windows[0].startMs).toBe(new Date(2026, 10, 5, 0, 0, 0).getTime());
    /* 今天右端裁到此刻，否则最后一根柱子的分母包含未来 5.6 小时，永远显矮 */
    expect(plan.windows[6].endMs).toBe(now);
  });

  it("t02_boundaries_start_and_end_match_the_query_range", () => {
    const plan = buildTrendQueryPlan(now, 7);
    /* 后端 validate_aggregate_boundaries：首 != startMs 或末 != endMs 会让整条读取失败 */
    expect(plan.boundaries[0]).toBe(plan.startMs);
    expect(plan.boundaries[plan.boundaries.length - 1]).toBe(plan.endMs);
    expect(plan.boundaries).toHaveLength(8);
    /* 逐日边界严格递增（桶不能重叠、不能漏） */
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
  });

  it("t03_records_are_bucketed_by_start_day_and_clipped", () => {
    const plan = buildTrendQueryPlan(now, 7);
    const day = plan.windows[2];
    const days = accumulateTrendDays(plan.windows, [
      /* 完整落在第 3 天：30 分钟 */
      { startTime: day.startMs + 9 * 3600_000, endTime: day.startMs + 9.5 * 3600_000 },
      /* 从前一天跨进来：只算落在本窗口的 10 分钟 */
      { startTime: day.startMs - 10 * 60_000, endTime: day.startMs + 10 * 60_000 },
      /* 完全在查询范围之外（首日之前）：与任何窗口无交集，丢弃 */
      { startTime: plan.startMs - 7200_000, endTime: plan.startMs - 3600_000 },
    ]);
    expect(days[2].durationMs).toBe(30 * 60_000 + 10 * 60_000);
    /* 跨午夜那段的前 10 分钟归前一天：墙钟分摊，与历史页同一口径。
     * 按"起点归日"的话这里会是 0，两天加起来就比历史页少 10 分钟。 */
    expect(days[1].durationMs).toBe(10 * 60_000);
    expect(days.reduce((sum, item) => sum + item.durationMs, 0)).toBe(50 * 60_000);
  });

  it("t04_bad_rows_do_not_poison_the_totals", () => {
    const plan = buildTrendQueryPlan(now, 7);
    const days = accumulateTrendDays(plan.windows, [
      { startTime: Number.NaN, endTime: plan.windows[0].startMs + 1000 },
      /* 倒挂区间（结束早于开始）：负时长会把柱子压成负值，必须丢 */
      { startTime: plan.windows[0].startMs + 5000, endTime: plan.windows[0].startMs + 1000 },
    ]);
    expect(days.every((day) => day.durationMs === 0)).toBe(true);
  });

  it("t05_short_day_window_still_returns_one_ordered_lane", () => {
    /* 页面刚过零点：今天只有几分钟，不能因此少一根柱、也不能把范围倒过来 */
    const justAfterMidnight = new Date(2026, 10, 11, 0, 3, 0).getTime();
    const plan = buildTrendQueryPlan(justAfterMidnight, 7);
    expect(plan.windows).toHaveLength(7);
    expect(plan.windows[6].endMs).toBe(justAfterMidnight);
    expect(plan.endMs).toBeGreaterThan(plan.startMs);
    expect(plan.boundaries.every((value, index) => index === 0 || value > plan.boundaries[index - 1])).toBe(true);
  });
});
