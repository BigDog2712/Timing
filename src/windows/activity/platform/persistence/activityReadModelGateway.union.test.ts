import { describe, expect, it } from "vitest";

import { parseActivityAggregateRange } from "./activityReadModelGateway.ts";
import { accumulateTrendDays, type TrendWindow } from "../../features/dashboard/services/trendDays.ts";
import { accumulateHeatmap, type HeatmapPlan } from "../../features/dashboard/services/heatmapDays.ts";

/**
 * **两台设备重叠时，格子显示的必须是 `union_ms`（30 分钟）而不是 `device_sum_ms`（60 分钟）。**
 *
 * 为什么这条钉在 gateway 层而不是 UI 文本上：柱高/格色是"看起来矮一点"，改了也不会报错；
 * 而 UI 用例只能断言"画了 24 根柱"。这里直接盯住**数字的来源**——
 *   · 后端回 `bucketUnionMs: [1800000]`；
 *   · `records` 两条各 30 分钟（合计 3_600_000）——如果实现退回"把 records 加起来"，
 *     断言立刻红，且红在具体毫秒数上。
 *
 * 生产库上是单设备（`union == device_sum` 恒成立），所以这条**只可能在构造数据里被咬住**
 * ——那正是它必须存在的原因。
 */
const HOUR = 3_600_000;
const DAY_START = new Date(2026, 9, 15, 0, 0, 0, 0).getTime();
const HOUR9 = DAY_START + 9 * HOUR;

const RANGE_PAYLOAD = {
  records: [
    /* 两台设备同一时段各 30 分钟（9:30–10:00 完全重合） */
    { appName: "Code", exeName: "code.exe", deviceId: "aaaa11112222",
      startTime: HOUR9 + 30 * 60_000, endTime: HOUR9 + HOUR },
    { appName: "Code", exeName: "code.exe", deviceId: "bbbb33334444",
      startTime: HOUR9 + 30 * 60_000, endTime: HOUR9 + HOUR },
  ],
  bucketUnionMs: [1_800_000],
  readPath: "facts",
  fallbackReason: null,
  sourceRevision: 7,
  projectionRowCount: 0,
  factRowCount: 2,
  hasActiveSession: false,
};

describe("聚合命令的逐桶并集（P2 · T07 的来源断言）", () => {
  it("解析出 bucketUnionMs 与 deviceId", () => {
    const parsed = parseActivityAggregateRange(RANGE_PAYLOAD);
    expect(parsed.bucketUnionMs).toEqual([1_800_000]);
    expect(parsed.records.map((record) => record.deviceId)).toEqual(["aaaa11112222", "bbbb33334444"]);
  });

  it("缺 bucketUnionMs（旧后端/旧 mock）时解析仍然成立，交给调用方退回老路径", () => {
    const { bucketUnionMs: _omitted, ...withoutUnion } = RANGE_PAYLOAD;
    expect(parseActivityAggregateRange(withoutUnion).bucketUnionMs).toBeUndefined();
  });

  it("bucketUnionMs 形状不对时拒绝整包（不静默当 0）", () => {
    expect(() => parseActivityAggregateRange({ ...RANGE_PAYLOAD, bucketUnionMs: [-1] })).toThrow();
    expect(() => parseActivityAggregateRange({ ...RANGE_PAYLOAD, bucketUnionMs: ["1800000"] })).toThrow();
  });

  it("records 相加是 60 分钟：证明下面的 30 分钟不可能来自 records", () => {
    const parsed = parseActivityAggregateRange(RANGE_PAYLOAD);
    const recordsSum = parsed.records.reduce((total, record) => total + (record.endTime - record.startTime), 0);
    expect(recordsSum).toBe(2 * 30 * 60_000);
  });

  it("趋势卡：格子取 30 分钟（union），不是 60 分钟（device_sum）", () => {
    const parsed = parseActivityAggregateRange(RANGE_PAYLOAD);
    const windows: TrendWindow[] = [{ key: "dT09", startMs: HOUR9, endMs: HOUR9 + HOUR }];
    const next = accumulateTrendDays(windows, parsed.records, {
      boundaries: [HOUR9, HOUR9 + HOUR],
      unionByBucket: parsed.bucketUnionMs ?? [],
    });
    expect(next[0].durationMs).toBe(1_800_000);
    /* 反向断言：少了 union 这一层就是 60 分钟——这条让"上面那句 30 分钟"不是碰巧 */
    expect(accumulateTrendDays(windows, parsed.records)[0].durationMs).toBe(3_600_000);
  });

  it("热力图：同一小时的格子取 30 分钟（union），不是 60 分钟（device_sum）", () => {
    const parsed = parseActivityAggregateRange(RANGE_PAYLOAD);
    const plan: HeatmapPlan = {
      startMs: HOUR9,
      endMs: HOUR9 + HOUR,
      boundaries: [HOUR9, HOUR9 + HOUR],
      days: [{ key: "2026-10-15", startMs: DAY_START, endMs: DAY_START + 24 * HOUR, weekday: 2 }],
      cells: [{ dayIndex: 0, weekday: 2, hour: 9, startMs: HOUR9, endMs: HOUR9 + HOUR }],
    };
    const next = accumulateHeatmap(plan, parsed.records, {
      boundaries: plan.boundaries,
      unionByBucket: parsed.bucketUnionMs ?? [],
    });
    expect(next.rows[2].cells[9]).toBe(1_800_000);
    expect(accumulateHeatmap(plan, parsed.records).rows[2].cells[9]).toBe(3_600_000);
  });
});
