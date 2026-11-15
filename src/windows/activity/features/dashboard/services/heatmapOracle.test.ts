import { describe, expect, it } from "vitest";

import { distributeBucketUnionMs } from "../../../shared/lib/bucketUnion.ts";
import {
  accumulateHeatmap,
  buildHeatmapPlan,
  HEATMAP_HOURS,
  HEATMAP_ROWS,
  type HeatmapPlan,
} from "./heatmapDays.ts";

/**
 * 672 格逐格相等：**旧实现留在测试里当 oracle**。
 *
 * 单设备库上热力图的格子必须与改造前一位不差（design §T07）。这里的对照不是"另写一张
 * 期望值表"——那是把同一个错误抄两遍；而是把**改造前那条求和路径**原样保留在这里，
 * 让新路径（后端逐桶并集 → 摊到格子）与它逐格比对。
 *
 * 只在单设备语义下比对：多设备时两者**本来就该不同**（union≠device_sum），
 * 那一条由 `activityReadModelGateway.union.test.ts` 钉。
 */
const HOUR = 3_600_000;

/** 旧路径：每条记录与每一格求交集再累加（等于改造前 `accumulateHeatmap` 的求和段） */
function oldPerCell(plan: HeatmapPlan, records: ReadonlyArray<{ startTime: number; endTime: number }>): number[] {
  return plan.cells.map((cell) => {
    let total = 0;
    for (const record of records) {
      const overlap = Math.min(record.endTime, cell.endMs) - Math.max(record.startTime, cell.startMs);
      if (overlap > 0) total += overlap;
    }
    return total;
  });
}

/**
 * 后端单设备路径：**逐桶把交集加起来**（`facts::bucket_unions` 的快路径）。
 * 位置在桶里丢了，但一台机器同一瞬间只有一个前台应用，加总就是真值。
 */
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

/** 确定性夹具（不用 `Math.random`：失败要能原样复现） */
function buildFixture(plan: HeatmapPlan) {
  const records: Array<{ startTime: number; endTime: number }> = [];
  for (let day = 0; day < plan.days.length; day += 1) {
    const dayStart = plan.days[day].startMs;
    /* 每天两段：上午一段跨整点、下午一段同小时内的两段（模拟窗口切换） */
    records.push({ startTime: dayStart + 9 * HOUR + 20 * 60_000, endTime: dayStart + 10 * HOUR + 5 * 60_000 });
    records.push({ startTime: dayStart + 14 * HOUR, endTime: dayStart + 14 * HOUR + 12 * 60_000 });
    records.push({ startTime: dayStart + 14 * HOUR + 12 * 60_000, endTime: dayStart + 14 * HOUR + 40 * 60_000 });
    if (day % 5 === 0) records.push({ startTime: dayStart + 22 * HOUR, endTime: dayStart + 23 * HOUR + 30 * 60_000 });
  }
  return records;
}

describe("热力图 672 格：单设备与改造前逐格相等", () => {
  /* 本地 23:59:59.999：今天也铺满 24 格，才有 4×7×24 = 672 */
  const nowMs = new Date(2026, 9, 15, 23, 59, 59, 999).getTime();
  const plan = buildHeatmapPlan(nowMs, 4);
  const records = buildFixture(plan);

  it("夹具确实铺满 672 格（否则下面的逐格比对会少比一段）", () => {
    expect(plan.days.length).toBe(28);
    expect(plan.cells.length).toBe(672);
  });

  it("672 个桶逐格相等（整数比较，失败时打印第几格）", () => {
    const unionByBucket = sumPerBucket(plan.boundaries, records);
    expect(unionByBucket.length).toBe(672);
    const next = distributeBucketUnionMs(plan.boundaries, unionByBucket, plan.cells);
    const base = oldPerCell(plan, records);
    for (let index = 0; index < plan.cells.length; index += 1) {
      const cell = plan.cells[index];
      expect(next[index], `cell#${index} weekday=${cell.weekday} hour=${cell.hour}`).toBe(base[index]);
    }
  });

  it("汇总后的 168 格（7×24）也逐格相等", () => {
    const unionByBucket = sumPerBucket(plan.boundaries, records);
    const next = accumulateHeatmap(plan, [], { boundaries: plan.boundaries, unionByBucket });
    const base = accumulateHeatmap(plan, records);
    expect(next.rows.length).toBe(HEATMAP_ROWS);
    expect(next.rows[0].cells.length).toBe(HEATMAP_HOURS);
    for (const row of next.rows) {
      for (let hour = 0; hour < HEATMAP_HOURS; hour += 1) {
        expect(row.cells[hour], `weekday=${row.weekday} hour=${hour}`).toBe(base.rows[row.weekday].cells[hour]);
      }
    }
    expect(next.maxMs).toBe(base.maxMs);
    expect(next.weeklyTotalMs).toBe(base.weeklyTotalMs);
  });

  it("不传并集时退回旧路径（旧快照/旧后端仍能画）", () => {
    const base = accumulateHeatmap(plan, records);
    const fallback = accumulateHeatmap(plan, records, undefined);
    expect(fallback).toEqual(base);
  });
});
