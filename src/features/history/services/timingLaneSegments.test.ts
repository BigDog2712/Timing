import { describe, expect, it } from "vitest";

import { addLocalDays, startOfLocalDay } from "../../../shared/lib/localDate.ts";
import { buildTimingLaneSegments, type TimingLaneWindow } from "./timingLaneSegments.ts";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/* 固定到某个本地日：所有断言都以「本地墙钟偏移」表达，因此换时区跑也成立。 */
const DAY = startOfLocalDay(new Date(2026, 10, 10));
const DAY_START = DAY.getTime();
const DAY_END = addLocalDays(DAY, 1).getTime();
const DAY_DURATION = DAY_END - DAY_START;

const items = [
  { id: 1, name: "写方案" },
  { id: 2, name: "改代码" },
];

/** 全天视口（0–24h），「现在」= 15:00 —— 与历史页 overview 轨的默认识口一致。 */
function fullDayWindow(overrides: Partial<TimingLaneWindow> = {}): TimingLaneWindow {
  return {
    dayStartMs: DAY_START,
    dayEndMs: DAY_END,
    viewportStartMs: DAY_START,
    viewportEndMs: DAY_END,
    visibleEndMs: DAY_START + 15 * HOUR,
    ...overrides,
  };
}

function at(hour: number, minute = 0): number {
  return DAY_START + hour * HOUR + minute * MINUTE;
}

describe("buildTimingLaneSegments", () => {
  it("无记录时返回空数组（调用方据此整条不渲染，不留空壳）", () => {
    expect(buildTimingLaneSegments({ records: [], items }, fullDayWindow())).toEqual([]);
  });

  it("与活动轨同一比例公式：14:00–14:30 落在 14h/24h，位置误差 ≤ 1 分钟", () => {
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 7,
          itemId: 1,
          seconds: 1800,
          startedAt: at(14, 0),
          endedAt: at(14, 30),
          runningSince: null,
        },
      ],
    }, fullDayWindow());

    /* 期望值用「墙钟偏移 / 全天时长」独立算一遍：这就是 `buildSegment` 的算法，
       两边不取整，所以误差理论上是 0；这里仍按 1 分钟容差断言，替未来重构留余地。 */
    const expectedStart = (14 * HOUR) / DAY_DURATION;
    const expectedWidth = (30 * MINUTE) / DAY_DURATION;
    expect(Math.abs(segment.startRatio - expectedStart) * DAY_DURATION).toBeLessThanOrEqual(MINUTE);
    expect(Math.abs(segment.widthRatio - expectedWidth) * DAY_DURATION).toBeLessThanOrEqual(MINUTE);
    expect(segment.startRatio).toBeCloseTo(expectedStart, 10);
    expect(segment.startTime).toBe(at(14, 0));
    expect(segment.endTime).toBe(at(14, 30));
    expect(segment.label).toBe("写方案");
  });

  it("进行中的记录延伸到 visibleEndMs（「现在」），并带 running 标记", () => {
    const window = fullDayWindow();
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 8,
          itemId: 2,
          seconds: 900,
          startedAt: at(13, 0),
          endedAt: null,
          runningSince: at(14, 0),
        },
      ],
    }, window);

    expect(segment.endTime).toBe(window.visibleEndMs);
    expect(segment.running).toBe(true);
  });

  it("暂停中的未结束记录同样画到「现在」，但不出 running 角标（时间没在走）", () => {
    const window = fullDayWindow();
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 9,
          itemId: 2,
          seconds: 900,
          startedAt: at(13, 0),
          endedAt: null,
          runningSince: null,
        },
      ],
    }, window);

    expect(segment.endTime).toBe(window.visibleEndMs);
    expect(segment.running).toBe(false);
  });

  it("已结束的记录按 endedAt 收尾，不延伸到「现在」", () => {
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 10,
          itemId: 1,
          seconds: 600,
          startedAt: at(9, 0),
          endedAt: at(9, 20),
          runningSince: null,
        },
      ],
    }, fullDayWindow());

    expect(segment.endTime).toBe(at(9, 20));
    expect(segment.running).toBe(false);
  });

  it("事项名查不到就丢掉这一段（与「同期计时」卡同一口径）", () => {
    const segments = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 11,
          itemId: 99,
          seconds: 600,
          startedAt: at(10, 0),
          endedAt: at(10, 10),
          runningSince: null,
        },
      ],
    }, fullDayWindow());

    expect(segments).toEqual([]);
  });

  it("超出视口的段丢弃；跨界的段裁剪到视口边缘", () => {
    /* 视口只开 13:00–15:00，三条记录：完全在左、完全在右、跨左边界。 */
    const window = fullDayWindow({
      viewportStartMs: at(13, 0),
      viewportEndMs: at(15, 0),
    });
    const segments = buildTimingLaneSegments({
      items,
      records: [
        { id: 12, itemId: 1, seconds: 600, startedAt: at(9, 0), endedAt: at(9, 10), runningSince: null },
        { id: 13, itemId: 1, seconds: 600, startedAt: at(16, 0), endedAt: at(16, 10), runningSince: null },
        { id: 14, itemId: 2, seconds: 900, startedAt: at(12, 30), endedAt: at(13, 30), runningSince: null },
      ],
    }, window);

    expect(segments).toHaveLength(1);
    expect(segments[0].startTime).toBe(at(13, 0));
    expect(segments[0].endTime).toBe(at(13, 30));
    expect(segments[0].startRatio).toBe(0);
  });

  it("跨零点的记录被日界裁掉：右端不过 dayEnd，左端不过 dayStart", () => {
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        {
          id: 15,
          itemId: 1,
          seconds: 3600,
          startedAt: DAY_START - 30 * MINUTE,
          endedAt: at(0, 30),
          runningSince: null,
        },
      ],
    }, fullDayWindow({ visibleEndMs: DAY_END }));

    expect(segment.startTime).toBe(DAY_START);
    expect(segment.endTime).toBe(at(0, 30));
  });

  it("亚分钟边界不取整：14:00:37 起、14:30:23 止必须落在毫秒原位", () => {
    /* 上一条用例的数据全部落在整分钟上——任何「取整到分钟」的实现都能混过去。
       B2 变异实验记录：把 clippedStart/clippedEnd 改成
       `Math.round(... / 60000) * 60000` 后，本文件 9 条用例**全绿**，
       也就是说「±1 分钟对齐」这条判据当时没有任何用例守着。
       这里专门喂一对带秒的边界：实现只要取整，startTime 就变成 14:01:00（差 23s），
       startRatio 随之偏移，两条断言同时红。 */
    const startedAt = at(14, 0) + 37_000;
    const endedAt = at(14, 30) + 23_000;
    const [segment] = buildTimingLaneSegments({
      items,
      records: [
        { id: 21, itemId: 1, seconds: 1786, startedAt, endedAt, runningSince: null },
      ],
    }, fullDayWindow());

    expect(segment.startTime).toBe(startedAt);
    expect(segment.endTime).toBe(endedAt);
    expect(segment.startRatio).toBeCloseTo((14 * HOUR + 37_000) / DAY_DURATION, 12);
    expect(segment.widthRatio).toBeCloseTo((29 * MINUTE + 46_000) / DAY_DURATION, 12);
    expect(Math.abs(segment.startRatio - (14 * HOUR + 37_000) / DAY_DURATION) * DAY_DURATION)
      .toBeLessThanOrEqual(MINUTE);
  });

  it("按开始时间升序返回，保证渲染层叠顺序稳定", () => {
    const segments = buildTimingLaneSegments({
      items,
      records: [
        { id: 16, itemId: 1, seconds: 600, startedAt: at(16, 0), endedAt: at(16, 10), runningSince: null },
        { id: 17, itemId: 2, seconds: 600, startedAt: at(8, 0), endedAt: at(8, 10), runningSince: null },
      ],
    }, fullDayWindow({ visibleEndMs: DAY_END }));

    expect(segments.map((segment) => segment.startTime)).toEqual([at(8, 0), at(16, 0)]);
  });
});
