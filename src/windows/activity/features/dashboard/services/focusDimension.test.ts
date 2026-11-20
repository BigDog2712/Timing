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
 *
 * 唯一的例外见文末 m01 组：分类维度与应用维度**必须同一个合计**（两者是同一份活动数据的
 * 两种分组，工具类已被统计口径摘掉，不是另一把尺子）。
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

/**
 * [0.12.6 · M1] 工具类**不进应用维度**。
 *
 * QA 复现的那一组数（`totalTrackedTime=1h, excludedToolTime=2h`）：
 *   · 分类维度合计 1h（读模型剔掉了工具类）；
 *   · 应用维度合计 3h（`fromApplications` 照单全收了 `topApplications`）—— 同一个环，
 *     切一下维度数字就变；
 *   · 应用环里 IDM 67% / VS Code 33%：百分比是卡里按 `value / total` 重算的，
 *     而读模型早就把工具类判成了 0%。
 *
 * 三处必须一次改齐（`fromApplications` 过滤 + `AppsModule` 的卡头合计 + 卡里改印切片
 * 自带的 `percentage`），只改一处会变成"三个口径里修好了一个"。
 * 组件级的判据在 `AppsModule.test.tsx`（apps15）与 `TimerModuleSource.test.tsx`（tm06）。
 */
describe("[M1] 工具类不进应用维度", () => {
  const HOUR = 3_600_000;
  /* 逐行事实：VS Code 1h（计入）+ IDM 2h（带「工具」标签，被统计口径排除） */
  const allStats: AppStat[] = [
    { exeName: "code.exe", appName: "VS Code", totalDuration: HOUR } as AppStat,
    { exeName: "idm.exe", appName: "Internet Download Manager", totalDuration: 2 * HOUR } as AppStat,
  ];
  const isTool = (stat: AppStat): boolean => stat.exeName === "idm.exe";
  /* 读模型的两个出口（`dashboardReadModel.buildDashboardReadModel` 逐字同一口径）：
     `totalTrackedTime` = 已计入合计；`categoryDist` 只吃 counted；`topApplications` 全量。 */
  const countedTotal = HOUR;
  const counted = allStats.filter((stat) => !isTool(stat));
  const model = {
    categories: buildCategoryDistribution(counted),
    applications: buildTopApplications(allStats, { isTool, totalDuration: countedTotal }),
    items: [] as TodayItemRow[],
  };

  it("m01a_app_total_equals_the_counted_total_never_the_full_list", () => {
    const byApp = buildFocusDistribution("app", model);
    expect(byApp.total, "应用维度把工具类的 2h 加回来了").toBe(countedTotal);
  });

  it("m01b_no_tool_app_enters_the_ring", () => {
    const byApp = buildFocusDistribution("app", model);
    expect(byApp.slices.map((slice) => slice.key)).toEqual(["code.exe"]);
  });

  it("m01c_the_slice_carries_the_read_model_percentage_not_a_recomputed_one", () => {
    const byApp = buildFocusDistribution("app", model);
    /* 读模型给的是 100（分母 = 已计入的 1h）；卡里按 `value / total` 重算会得到 33 */
    expect(byApp.slices[0]?.percentage).toBe(100);
    /* 排行列表**仍然**带着工具行 —— 那一行是"我的时长去哪了"的唯一解释，不许一起删 */
    expect(model.applications.map((app) => app.exeName)).toEqual(["code.exe", "idm.exe"]);
    expect(model.applications.find((app) => app.exeName === "idm.exe")?.percentage).toBe(0);
  });

  it("m01d_category_and_app_dimensions_report_the_same_total", () => {
    /* 这两个维度是同一份活动数据的两种分组 —— 合计必须一样，否则"切维度"就是在改数 */
    expect(buildFocusDistribution("app", model).total)
      .toBe(buildFocusDistribution("category", model).total);
  });

  it("m01e_non_tool_slices_have_no_invented_percentage_when_the_model_had_none", () => {
    /* 分类 / 事项维度读模型不产百分比：切片上就不该有字段（卡里回退自算，行为与旧版一致） */
    expect(buildFocusDistribution("category", model).slices.every((slice) => slice.percentage === undefined)).toBe(true);
    expect(buildFocusDistribution("item", { ...model, items }).slices.every((slice) => slice.percentage === undefined)).toBe(true);
  });
});
