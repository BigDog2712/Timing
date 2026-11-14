import { describe, expect, it } from "vitest";

import { distributeBucketUnionMs } from "../../../shared/lib/bucketUnion.ts";
import { accumulateTrendDays, type TrendWindow } from "./trendDays.ts";

/**
 * 趋势卡 24 格：旧实现（按记录求交集）留在测试里当 oracle，新实现（后端逐桶并集）逐格比。
 *
 * 与热力图分开写，是因为趋势卡多一层真实风险：**查询边界裁到此刻、展示轴恒 24 格**，
 * 两个数组长度不一样，桶与窗口不是一一对应。热力图那 672 格是等长的，咬不到这条。
 */
const HOUR = 3_600_000;

function windowsOf(dayStartMs: number): TrendWindow[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    key: `dT${String(hour).padStart(2, "0")}`,
    startMs: dayStartMs + hour * HOUR,
    endMs: dayStartMs + (hour + 1) * HOUR,
  }));
}

/** 旧路径：记录 × 窗口求交集累加 */
function oldPerWindow(windows: readonly TrendWindow[], records: ReadonlyArray<{ startTime: number; endTime: number }>): number[] {
  return windows.map((window) => {
    let total = 0;
    for (const record of records) {
      const overlap = Math.min(record.endTime, window.endMs) - Math.max(record.startTime, window.startMs);
      if (overlap > 0) total += overlap;
    }
    return total;
  });
}

function sumPerBucket(boundaries: readonly number[], records: ReadonlyArray<{ startTime: number; endTime: number }>): number[] {
  const totals = new Array<number>(Math.max(0, boundaries.length - 1)).fill(0);
  for (const record of records) {
    for (let index = 0; index < totals.length; index += 1) {
      const overlap = Math.min(record.endTime, boundaries[index + 1]) - Math.max(record.startTime, boundaries[index]);
      if (overlap > 0) totals[index] += overlap;
    }
  }
  return totals;
}

describe("趋势卡 24 格：单设备与改造前逐格相等", () => {
  const dayStartMs = new Date(2026, 9, 15, 0, 0, 0, 0).getTime();
  const windows = windowsOf(dayStartMs);
  /* 查询桶 = 前 19 个整点（模拟"现在 18:40"），展示轴 = 24 格 */
  const queryBoundaries = Array.from({ length: 20 }, (_, index) => dayStartMs + index * HOUR);
  const records = [
    { startTime: dayStartMs + 9 * HOUR + 25 * 60_000, endTime: dayStartMs + 10 * HOUR + 10 * 60_000 },
    { startTime: dayStartMs + 13 * HOUR, endTime: dayStartMs + 13 * HOUR + 40 * 60_000 },
    { startTime: dayStartMs + 18 * HOUR + 5 * 60_000, endTime: dayStartMs + 18 * HOUR + 40 * 60_000 },
  ];

  it("24 格逐格相等（含查询桶少于展示窗口时，多出来的格必须是 0）", () => {
    const unionByBucket = sumPerBucket(queryBoundaries, records);
    const next = accumulateTrendDays(windows, [], { boundaries: queryBoundaries, unionByBucket });
    const base = oldPerWindow(windows, records);
    expect(next.length).toBe(24);
    for (let hour = 0; hour < 24; hour += 1) {
      expect(next[hour].durationMs, `hour=${hour}`).toBe(base[hour]);
    }
    expect(next.slice(19).every((entry) => entry.durationMs === 0)).toBe(true);
  });

  it("裁到此刻的那一格按比例分摊（未来不算进去）", () => {
    /* 19:00–19:20 实际发生，桶边界裁在 19:10：旧路径只算 10 分钟 */
    const cutBoundaries = [...queryBoundaries, dayStartMs + 19 * HOUR + 10 * 60_000];
    const late = [{ startTime: dayStartMs + 19 * HOUR, endTime: dayStartMs + 19 * HOUR + 20 * 60_000 }];
    const unionByBucket = sumPerBucket(cutBoundaries, late);
    expect(unionByBucket[19]).toBe(10 * 60_000);
    const next = accumulateTrendDays(windows, [], { boundaries: cutBoundaries, unionByBucket });
    expect(next[19].durationMs).toBe(10 * 60_000);
  });

  it("不传并集时退回旧路径", () => {
    expect(accumulateTrendDays(windows, records, undefined)).toEqual(accumulateTrendDays(windows, records));
  });

  it("逐格相等的实现确实用到了 distributeBucketUnionMs 的比例分支", () => {
    const boundaries = [dayStartMs, dayStartMs + HOUR];
    expect(distributeBucketUnionMs(boundaries, [HOUR], [{ startMs: dayStartMs, endMs: dayStartMs + HOUR / 2 }]))
      .toEqual([HOUR / 2]);
  });
});
