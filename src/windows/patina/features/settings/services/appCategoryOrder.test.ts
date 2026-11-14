/**
 * 「应用 → 分类」排序的判据。
 *
 * 这一层是**界面显示的「首位」与后端规则 2 的唯一接缝**：两边排序不一致时，
 * 界面上标的「首位：社交」与实际切片的「娱乐」会同时「看起来对」，零报错。
 */
import { describe, expect, it } from "vitest";

import {
  appendCategory,
  compareAppCategory,
  groupByApp,
  moveCategory,
  reassignPriorities,
  sortCategories,
} from "./appCategoryOrder.ts";
import type { AppCategoryRow } from "../../../platform/persistence/attributionGateway.ts";

function row(appKey: string, categoryKey: string, priority: number): AppCategoryRow {
  return { appKey, categoryKey, priority };
}

describe("compareAppCategory", () => {
  it("priority 小的在前", () => {
    expect(compareAppCategory(row("chrome", "game", 10), row("chrome", "study", 20))).toBeLessThan(0);
  });

  it("同 priority 按 categoryKey 字典序（与 Rust 侧 tiebreak 一致）", () => {
    /* 这条是本文件存在的理由：Rust 的 `min_by` 在 priority 相等时比 category_key，
       界面若保持取数顺序，「同 priority 两组谁在前」就变成插入顺序的函数。 */
    const rows = [row("chrome", "study", 100), row("chrome", "game", 100)];
    expect(sortCategories(rows).map((entry) => entry.categoryKey)).toEqual(["game", "study"]);
  });

  it("排序不改入参", () => {
    const rows = [row("chrome", "study", 20), row("chrome", "game", 10)];
    const snapshot = [...rows];
    sortCategories(rows);
    expect(rows).toEqual(snapshot);
  });
});

describe("moveCategory", () => {
  it("上移一位后重新分配 priority（10 的倍数）", () => {
    const rows = [row("chrome", "study", 0), row("chrome", "game", 10), row("chrome", "work", 20)];
    expect(moveCategory(rows, "game", "up")).toEqual([
      row("chrome", "game", 0),
      row("chrome", "study", 10),
      row("chrome", "work", 20),
    ]);
  });

  it("已在首位时上移是空操作（返回等价副本，不改 priority）", () => {
    const rows = [row("chrome", "study", 0), row("chrome", "game", 10)];
    expect(moveCategory(rows, "study", "up")).toEqual(sortCategories(rows));
  });

  it("已在末位时下移是空操作", () => {
    const rows = [row("chrome", "study", 0), row("chrome", "game", 10)];
    expect(moveCategory(rows, "game", "down")).toEqual(sortCategories(rows));
  });

  it("找不到该分类时原样返回，不抛错", () => {
    const rows = [row("chrome", "study", 0)];
    expect(moveCategory(rows, "nope", "up")).toEqual(rows);
  });

  it("先排序再移动：入参乱序时也按 priority 判断邻居", () => {
    /* 乱序入参 + 直接按下标交换 = 移动了「取数顺序里的邻居」，而不是「界面上的邻居」。
       用户点一次上移，界面上的第二行没动，反而第三行跳了。 */
    const rows = [row("chrome", "work", 20), row("chrome", "study", 0), row("chrome", "game", 10)];
    expect(moveCategory(rows, "work", "up").map((entry) => entry.categoryKey))
      .toEqual(["study", "work", "game"]);
  });
});

describe("appendCategory", () => {
  it("追加到末尾，priority = 末位 + 10", () => {
    const rows = [row("chrome", "study", 0), row("chrome", "game", 10)];
    expect(appendCategory(rows, "chrome", "work")).toEqual([
      row("chrome", "study", 0),
      row("chrome", "game", 10),
      row("chrome", "work", 20),
    ]);
  });

  it("空组时 priority 从 0 起，且 appKey 来自参数", () => {
    expect(appendCategory([], "chrome", "study")).toEqual([row("chrome", "study", 0)]);
  });

  it("空组时不会落下空 appKey（那会是一条永远查不出来的行）", () => {
    const [created] = appendCategory([], "chrome", "study");
    expect(created.appKey).toBe("chrome");
  });
});

describe("reassignPriorities / groupByApp", () => {
  it("重排按下标 × 10", () => {
    expect(reassignPriorities([row("a", "x", 7), row("a", "y", 3)]).map((entry) => entry.priority))
      .toEqual([0, 10]);
  });

  it("分组后组内有序、组间按 appKey 字典序", () => {
    const grouped = groupByApp([
      row("wechat", "social", 0),
      row("chrome", "study", 10),
      row("chrome", "game", 0),
    ]);
    expect([...grouped.keys()]).toEqual(["chrome", "wechat"]);
    expect(grouped.get("chrome")?.map((entry) => entry.categoryKey)).toEqual(["game", "study"]);
  });
});
