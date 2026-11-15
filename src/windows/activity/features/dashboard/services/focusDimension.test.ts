import { describe, expect, it } from "vitest";
import { buildFocusDistribution, isFocusDimension } from "./focusDimension";
import type { AppStat } from "../../../shared/types/app";
import type { TodayItemRow } from "../hooks/useTodayItems";
import { buildCategoryDistribution, buildTopApplications } from "./dashboardFormatting";

/**
 * [P2 修正 · 0.12.1] 三个维度：分类 / 应用 / **事项**。
 *
 * 本轮修正的口径：第三维换成了 Timing 自己的事项（`useTodayItems` 的聚合结果），
 * 不再是应用窗口标题。因此**不再断言「三个维度总量相等」**——分类/应用来自活动采集，
 * 事项来自计时记录，两者度量的是不同的东西（电脑上发生过什么 vs 用户主动计了什么）。
 * 假自洽比不相等更危险：它会让「事项比我记得的少」这种真问题看起来像正常。
 */
const stats: AppStat[] = [
  { exeName: "code.exe", appName: "VS Code", totalDuration: 3_600_000 } as AppStat,
  { exeName: "chrome.exe", appName: "Chrome", totalDuration: 2_400_000 } as AppStat,
];

function itemRow(itemId: number, name: string, value: number, firstStart = 0): TodayItemRow {
  return { itemId, name, color: "", value, firstStart, lastEnd: firstStart + value, segments: 1 };
}

const items: TodayItemRow[] = [
  itemRow(7, "写方案", 1_800_000, 1_000),
  itemRow(8, "看文档", 600_000, 2_000),
];

describe("buildFocusDistribution", () => {
  const source = {
    categories: buildCategoryDistribution(stats),
    applications: buildTopApplications(stats),
    items,
  };

  it("c01a_category_and_app_are_two_groupings_of_the_same_measure", () => {
    const byCategory = buildFocusDistribution("category", source);
    const byApp = buildFocusDistribution("app", source);
    expect(byCategory.total).toBe(6_000_000);
    expect(byApp.total).toBe(byCategory.total);
  });

  it("c01b_item_dimension_comes_from_timing_records_not_window_titles", () => {
    const byItem = buildFocusDistribution("item", source);
    expect(byItem.total).toBe(2_400_000);
    expect(byItem.slices.map((slice) => slice.name)).toEqual(["写方案", "看文档"]);
    /* key 是事项 id：两张同名事项不会被合并成一行 */
    expect(byItem.slices.map((slice) => slice.key)).toEqual(["7", "8"]);
  });

  it("c01c_item_total_is_independent_from_activity_total", () => {
    const byApp = buildFocusDistribution("app", source);
    const byItem = buildFocusDistribution("item", source);
    /* 两者不等是**正常**的：一个是活动采集，一个是主动计时。这条钉的是「不许假装相等」。 */
    expect(byItem.total).not.toBe(byApp.total);
  });

  it("c01d_only_category_slices_carry_a_category", () => {
    expect(buildFocusDistribution("category", source).slices.every((slice) => typeof slice.category === "string")).toBe(true);
    expect(buildFocusDistribution("app", source).slices.every((slice) => slice.category === undefined)).toBe(true);
    expect(buildFocusDistribution("item", source).slices.every((slice) => slice.category === undefined)).toBe(true);
  });

  it("c02_isFocusDimension_only_accepts_the_three_known_values", () => {
    expect(isFocusDimension("category")).toBe(true);
    expect(isFocusDimension("app")).toBe(true);
    expect(isFocusDimension("item")).toBe(true);
    expect(isFocusDimension("title")).toBe(false);
    expect(isFocusDimension(null)).toBe(false);
  });
});
