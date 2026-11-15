import { describe, expect, it } from "vitest";

import { distributeBucketUnionMs } from "./bucketUnion.ts";

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 9, 15, 0, 0, 0);

/**
 * 这一层的唯一职责：把「桶」对齐到「展示窗口」。
 *
 * 两个真实会出错的地方都在用例里：
 *   ① 末窗口被裁到"此刻"——整桶取值会把未来算进去；
 *   ② DST 前跳日少一个桶——按序号硬对齐会让整条轴从那一格起偏一小时。
 */
describe("distributeBucketUnionMs", () => {
  it("整桶覆盖时逐格等于原值（不引入除法，所以没有舍入）", () => {
    const boundaries = [T0, T0 + HOUR, T0 + 2 * HOUR];
    const windows = [{ startMs: T0, endMs: T0 + HOUR }, { startMs: T0 + HOUR, endMs: T0 + 2 * HOUR }];
    expect(distributeBucketUnionMs(boundaries, [1_800_000, 600_000], windows)).toEqual([1_800_000, 600_000]);
  });

  it("末窗口只覆盖桶的前半截时按比例分配", () => {
    const boundaries = [T0, T0 + HOUR];
    const windows = [{ startMs: T0, endMs: T0 + HOUR / 2 }];
    expect(distributeBucketUnionMs(boundaries, [1_800_000], windows)).toEqual([900_000]);
  });

  it("窗口比桶宽时把跨过的桶加起来（DST 少一格时的错位不丢数据）", () => {
    const boundaries = [T0, T0 + HOUR, T0 + 2 * HOUR];
    const windows = [{ startMs: T0, endMs: T0 + 2 * HOUR }];
    expect(distributeBucketUnionMs(boundaries, [1_000, 2_000], windows)).toEqual([3_000]);
  });

  it("没有桶（空边界）时全 0，不抛", () => {
    expect(distributeBucketUnionMs([], [], [{ startMs: T0, endMs: T0 + HOUR }])).toEqual([0]);
  });

  it("桶数与窗口数不一致时不越界（后端少回一格也不 panic）", () => {
    const boundaries = [T0, T0 + HOUR, T0 + 2 * HOUR];
    const windows = [{ startMs: T0, endMs: T0 + HOUR }];
    expect(distributeBucketUnionMs(boundaries, [1_234], windows)).toEqual([1_234]);
  });
});
