import { describe, expect, it } from "vitest";

import { buildTimingOverlap } from "./timingOverlap.ts";

const items = [
  { id: 1, name: "写方案" },
  { id: 2, name: "改代码" },
  { id: 3, name: "开会" },
];

describe("buildTimingOverlap", () => {
  it("同一事项的多条记录合并成一条，条数一起累加", () => {
    const slices = buildTimingOverlap({
      items,
      records: [
        { itemId: 1, seconds: 600 },
        { itemId: 1, seconds: 300 },
        { itemId: 2, seconds: 120 },
      ],
    });

    expect(slices).toEqual([
      { name: "写方案", seconds: 900, count: 2 },
      { name: "改代码", seconds: 120, count: 1 },
    ]);
  });

  it("按时长降序，最长的那件在最前面", () => {
    const slices = buildTimingOverlap({
      items,
      records: [
        { itemId: 3, seconds: 60 },
        { itemId: 2, seconds: 3600 },
        { itemId: 1, seconds: 600 },
      ],
    });

    expect(slices.map((slice) => slice.name)).toEqual(["改代码", "写方案", "开会"]);
  });

  it("超过条数上限时只留最长的几条", () => {
    const slices = buildTimingOverlap(
      {
        items,
        records: [
          { itemId: 1, seconds: 100 },
          { itemId: 2, seconds: 200 },
          { itemId: 3, seconds: 300 },
        ],
      },
      2,
    );

    expect(slices.map((slice) => slice.name)).toEqual(["开会", "改代码"]);
  });

  it("名字查不到的事项整条丢掉，不显示编号", () => {
    const slices = buildTimingOverlap({
      items,
      records: [
        { itemId: 99, seconds: 500 },
        { itemId: 1, seconds: 60 },
      ],
    });

    expect(slices).toEqual([{ name: "写方案", seconds: 60, count: 1 }]);
  });

  it("零秒与负秒不占一行", () => {
    const slices = buildTimingOverlap({
      items,
      records: [
        { itemId: 1, seconds: 0 },
        { itemId: 2, seconds: -5 },
      ],
    });

    expect(slices).toEqual([]);
  });

  it("没有记录时返回空数组（界面据此整块不渲染）", () => {
    expect(buildTimingOverlap({ items, records: [] })).toEqual([]);
  });
});
