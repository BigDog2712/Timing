import { describe, expect, it } from "vitest";

import { accumulateTrendDays, buildTodayHourPlan, type LocalHourStamp } from "./trendDays";

/**
 * 今日分时计划的几何判据。这几条钉的都是**算错了也照样出货**的地方：
 * 柱子矮一截、某个小时的时长归到隔壁小时、末窗口分母包含未来、零点整那一刻整条读取失败
 * —— 界面全都正常渲染。
 */
describe("今日活动趋势 · 按小时切桶", () => {
  /* 2026-11-11 18:24 本地时间（东八区） */
  const now = new Date(2026, 10, 11, 18, 24, 0).getTime();
  const dayStart = new Date(2026, 10, 11, 0, 0, 0).getTime();

  it("t01_starts_at_local_midnight_and_covers_every_hour_up_to_now", () => {
    const plan = buildTodayHourPlan(now);
    /* 起点是本地 00:00，不是 UTC 00:00：UTC 切法会让首窗口变成当天 08:00 */
    expect(plan.startMs).toBe(dayStart);
    expect(plan.windows[0].startMs).toBe(dayStart);
    /* 窗口数 = 当前小时 + 1（含"当前这一小时"）：18 点 → 0…18 共 19 个 */
    expect(plan.windows).toHaveLength(19);
    expect(plan.windows[18].startMs).toBe(new Date(2026, 10, 11, 18, 0, 0).getTime());
    /* 末窗口右端裁到「此刻」而不是 19:00：分母算上还没到的 36 分钟，那根柱永远显矮 */
    expect(plan.windows[18].endMs).toBe(now);
    expect(plan.endMs).toBe(now);
  });

  it("t02_boundaries_head_and_tail_match_the_query_range_and_strictly_increase", () => {
    const plan = buildTodayHourPlan(now);
    /* 后端 validate_aggregate_boundaries：首 != startMs 或末 != endMs 会让整条读取失败 */
    expect(plan.boundaries[0]).toBe(plan.startMs);
    expect(plan.boundaries[plan.boundaries.length - 1]).toBe(plan.endMs);
    expect(plan.boundaries).toHaveLength(plan.windows.length + 1);
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
  });

  it("t03_records_are_split_by_wall_clock_inside_the_hour_they_belong_to", () => {
    const plan = buildTodayHourPlan(now);
    const windows = accumulateTrendDays(plan.windows, [
      /* 跨整点：09:50–10:20 → 9 点 10 分钟、10 点 20 分钟 */
      {
        startTime: new Date(2026, 10, 11, 9, 50, 0).getTime(),
        endTime: new Date(2026, 10, 11, 10, 20, 0).getTime(),
      },
      /* 跨午夜：昨天 23:50 – 今天 00:20 → 今天只有 0 点那 20 分钟（前 10 分钟不在查询区间内） */
      {
        startTime: new Date(2026, 10, 10, 23, 50, 0).getTime(),
        endTime: new Date(2026, 10, 11, 0, 20, 0).getTime(),
      },
    ]);
    expect(windows[9].durationMs).toBe(10 * 60_000);
    expect(windows[10].durationMs).toBe(20 * 60_000);
    expect(windows[0].durationMs).toBe(20 * 60_000);
    /* 一共 50 分钟，一分钟都没丢、也没有被整段塞给同一个小时 */
    expect(windows.reduce((sum, item) => sum + item.durationMs, 0)).toBe(50 * 60_000);
  });

  it("t04_exactly_midnight_still_yields_one_ordered_window", () => {
    /* 页面正好在 00:00:00 刷新：endMs === startMs 会让整条读取失败、卡片变空 */
    const plan = buildTodayHourPlan(dayStart);
    expect(plan.windows).toHaveLength(1);
    expect(plan.startMs).toBe(dayStart);
    expect(plan.endMs).toBeGreaterThan(plan.startMs);
    expect(plan.boundaries).toEqual([plan.startMs, plan.endMs]);
  });

  it("t05_exactly_on_the_hour_does_not_leave_a_zero_length_tail_window", () => {
    /* 18:00:00 整：第 19 个窗口 [18:00, 18:00] 一秒都没过去，留着会让边界重复 */
    const onTheHour = new Date(2026, 10, 11, 18, 0, 0).getTime();
    const plan = buildTodayHourPlan(onTheHour);
    expect(plan.windows).toHaveLength(18);
    expect(plan.endMs).toBe(onTheHour);
    expect(plan.windows[plan.windows.length - 1].endMs).toBe(onTheHour);
    for (let index = 1; index < plan.boundaries.length; index += 1) {
      expect(plan.boundaries[index]).toBeGreaterThan(plan.boundaries[index - 1]);
    }
  });

  it("t06_late_night_still_covers_the_whole_day", () => {
    /* 23:30：24 个窗口（0…23），最后一格只过去 30 分钟 */
    const late = new Date(2026, 10, 11, 23, 30, 0).getTime();
    const plan = buildTodayHourPlan(late);
    expect(plan.windows).toHaveLength(24);
    expect(plan.windows[23].endMs).toBe(late);
    expect(plan.boundaries).toHaveLength(25);
  });

  it("t07_bad_rows_do_not_poison_the_totals", () => {
    const plan = buildTodayHourPlan(now);
    const windows = accumulateTrendDays(plan.windows, [
      { startTime: Number.NaN, endTime: plan.startMs + 1000 },
      /* 倒挂区间（结束早于开始）：负时长会把柱子压成负值，必须丢 */
      { startTime: plan.startMs + 5000, endTime: plan.startMs + 1000 },
    ]);
    expect(windows.every((window) => window.durationMs === 0)).toBe(true);
  });
});

/**
 * 夏令时**前跳日**（DST spring forward）的几何判据。
 *
 * ## 为什么注入一个「整点构造器」而不是切 `TZ`
 *
 * 这条路的触发条件是「本地 02:00 不存在」，而 **Node 会忽略 `TZ` 环境变量**（实测：
 * `process.env.TZ = "America/New_York"` 之后 `new Date(…).getHours()` 一毫秒都没变）。
 * 在测试里改时区只会得到一个「看起来在测时区、其实还在原时区」的假绿。
 *
 * 所以 `buildTodayHourPlan` 的第二个参数是一个 `LocalHourStamp`，默认实现仍是
 * `new Date(y, m, d, hour)`（生产语义一字未改）；这里注入一个**忠实模拟前跳日**的实现：
 * 本地钟 02:00 不存在 → `00:00` 走 0h、`01:00` 走 1h、`02:00` 被 JS 归一化成 `03:00`
 * （也是 2h 之后）、`03:00` 又落回**同一个瞬间**、`04:00` 才是 3h 之后。
 * 于是 `hour=2` 与 `hour=3` 指向同一毫秒 —— 正是线上那颗重复边界的来源。
 *
 * 修不好的症状是**静默的**：`boundaries` 里出现两个相同值 → 后端
 * `activity_read_model` 的 `pair[1] <= pair[0]` 直接把整条 `aggregate_range` 判掉 →
 * 趋势卡冻结旧图或变错误块，且一年只有那一天从本地 02:00 起全天如此。
 */
describe("今日活动趋势 · 夏令时前跳日", () => {
  /**
   * 前跳日的整点构造器：`hour` 是**本地钟面**的小时，返回值是真实时间戳。
   * `hour <= 2` 时按 0/1/2 小时推进（02:00 归一化后就是本地 03:00 那一刻），
   * `hour >= 3` 时扣掉被跳掉的那一小时。
   */
  const springForwardStamp: LocalHourStamp = (dayStart, hour) => {
    const midnight = new Date(
      dayStart.getFullYear(),
      dayStart.getMonth(),
      dayStart.getDate(),
      0,
      0,
      0,
    ).getTime();
    return midnight + (hour <= 2 ? hour : hour - 1) * 3_600_000;
  };

  /* 时刻取在**模拟钟面的 18:00 整**（半夜起 17h，因为 02:00 那一小时不存在）。
     为什么压在整点上：注入的钟面与运行机时区是两套钟，「末窗口裁到此刻」这条只有让
     nowMs 恰好落在钟面整点时才自洽；零长尾部本身由 t05 覆盖，不必在这里重复。 */
  const midnight = new Date(2026, 2, 8, 0, 0, 0).getTime();
  const nowMs = midnight + 17 * 3_600_000;

  it("t08_boundaries_stay_strictly_increasing_and_no_hour_is_dropped", () => {
    const plan = buildTodayHourPlan(nowMs, springForwardStamp);

    /* ① 严格递增：后端对 `pair[1] <= pair[0]` 的反应是整条读取失败（卡片冻结/报错） */
    expect(plan.boundaries.every((value, index, array) => index === 0 || value > array[index - 1])).toBe(true);
    expect(plan.boundaries).toHaveLength(plan.windows.length + 1);
    /* ② 没有零长窗口（02:00 那颗不许留着占位） */
    expect(plan.windows.every((window) => window.endMs > window.startMs)).toBe(true);
    /* ③ 窗口**首尾相接**：前跳那一段（本地 03:00–04:00）必须落在某个窗口里。
       只保证"严格递增"是不够的 —— 把 02:00 与 03:00 都跳过也能递增，但那一小时的
       时长会不属于任何窗口，柱子少一截且没有任何报错。 */
    expect(plan.windows.slice(1).every((window, index) => window.startMs === plan.windows[index].endMs)).toBe(true);
    /* ④ 被跳掉的只有不存在的那个小时：03:00 那一格在，且是完整一小时 */
    const covering = plan.windows.find((window) => window.startMs === midnight + 2 * 3_600_000);
    expect(covering?.endMs).toBe(midnight + 3 * 3_600_000);
    /* ⑤ 窗口数与小时数一致：0…17 共 18 个整点，减去被抹掉的 02:00 那一个；
       18:00 整这一刻的窗口是零长，不占位。key 也必须唯一（重复 key 会让 React 复用错行）。 */
    expect(plan.windows).toHaveLength(17);
    expect(new Set(plan.windows.map((window) => window.key)).size).toBe(17);
    /* ⑥ 首 == startMs、末 == endMs：后端另一条校验 */
    expect(plan.boundaries[0]).toBe(plan.startMs);
    expect(plan.boundaries[plan.boundaries.length - 1]).toBe(plan.endMs);
    expect(plan.endMs).toBe(nowMs);
  });

  it("t09_records_inside_the_skipped_hour_land_in_the_window_that_covers_them", () => {
    /* 03:00–03:30 这段活动（本地钟面 03 点）必须落在窗口里，不能被"跳过重复起点"吞掉 */
    const plan = buildTodayHourPlan(nowMs, springForwardStamp);
    const windows = accumulateTrendDays(plan.windows, [
      { startTime: midnight + 2 * 3_600_000, endTime: midnight + 2 * 3_600_000 + 30 * 60_000 },
    ]);
    expect(windows.reduce((sum, item) => sum + item.durationMs, 0)).toBe(30 * 60_000);
  });
});

