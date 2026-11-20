/**
 * [P2 修正 · 0.12.1] 专注窗口的三个维度：分类 / 应用 / **事项**。
 *
 * 主人口径（2026-11-11）：「事项分布显示的是悬浮窗内的事项，而非应用的」。
 * 第三维取 Timing 自己的 `items` + `time_records`（经 `useTodayItems` 聚合），
 * **不是** `CompiledSession.displayTitle`（那是应用窗口标题）——上一版用错源，这里改回。
 *
 * 三个维度不再同源（分类/应用来自活动采集，事项来自计时记录），所以**总量不再要求相等**：
 * 两者度量的是不同的东西（电脑上发生过什么 vs 用户主动计了什么）。
 * 不做「三个数必须相等」的假自洽，各自的总计各说各话。
 *
 * [0.12.6 · M1] 唯一一条**必须相等**的：应用维度的 `total` === `totalTrackedTime`。
 * 两者都是"统计口径内的应用活动合计"（工具类已被 `splitToolStats` 摘掉），
 * 应用维度只是换了个分组方式，不是另一把尺子。判据见 `focusDimension.test.ts` 的 m01 组。
 */
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import type { CategoryDistItem, TopApplicationItem } from "./dashboardFormatting.ts";

export const FOCUS_DIMENSIONS = ["category", "app", "item"] as const;
export type FocusDimension = (typeof FOCUS_DIMENSIONS)[number];

export interface FocusSlice {
  key: string;
  name: string;
  value: number;
  color: string;
  category?: AppCategory;
  /**
   * 占当前维度合计的百分比（整数）。**只有读模型算过的那一维才带**（应用维度）。
   *
   * 为什么要有这个字段（0.12.6 · M1）：计时卡的读数行原来自行用 `value / total` 重算
   * 一遍占比。那份重算看得见"这一段值多少"，看不见"读模型把谁剔出了统计" —— 应用维度里
   * 工具类被判成 `percentage: 0`（它们不在分母里），重算却会因为分母悄悄变回全量而算出
   * 一个像模像样的 67%。同一份数据有两个算法，迟早印出两个数。切片自带读数就印读数。
   *
   * 为什么可选：分类 / 事项维度的读模型不产百分比（那两处本来就是卡内自洽的一段），
   * 缺省 = 卡里按 `value / total` 算，与 0.12.5 逐字一致。
   */
  percentage?: number;
}

export interface FocusDistribution {
  dimension: FocusDimension;
  slices: FocusSlice[];
  total: number;
}

export function isFocusDimension(value: unknown): value is FocusDimension {
  return value === "category" || value === "app" || value === "item";
}

function fromCategories(categories: readonly CategoryDistItem[]): FocusSlice[] {
  return categories.map((item) => ({
    key: item.category,
    name: item.name,
    value: Math.max(0, item.value),
    color: item.color,
    category: item.category,
  }));
}

/**
 * 应用维度：**只吃统计口径内的应用**（`isTool === true` 的不进环、也不进 total）。
 *
 * 为什么必须在这里筛（M1）：工具类应用在 `dashboardReadModel.splitToolStats` 里已经被
 * 摘出了总量与分类分布，但 `topApplications` 是**全量**的（排行要能看见"IDM 被标成工具了"），
 * 这里若照单全收，同一个界面会同时出现三个数：环心/卡头 3h（含工具）、分类维度 1h、
 * 排行卡头又是 3h —— 切一下维度数字就变，用户能自己复现，而且没法判断哪个是对的。
 *
 * 筛完的效果正好是 `totalTrackedTime`（读模型里"已计入"的合计），于是三个维度里
 * 分类与应用同源同量、事项各说各话；工具行的时长仍然只在**排行列表**里出现。
 */
function fromApplications(apps: readonly TopApplicationItem[]): FocusSlice[] {
  return apps
    .filter((app) => app.isTool !== true)
    .map((app) => ({
      key: app.exeName,
      name: app.name,
      value: Math.max(0, app.duration),
      color: app.color,
      /* 读模型已经把"这一行该显示百分之几"算好了（工具类是 0、其余按已计入合计分摊），
         这里原样带出去 —— 卡里再算一遍就是第二个口径。 */
      percentage: app.percentage,
    }));
}

/** 事项维度：`useTodayItems` 已按事项聚合（名字/累计/段数），这里只换形。 */
function fromItems(items: readonly TodayItemRow[]): FocusSlice[] {
  return items.map((item) => ({
    key: String(item.itemId),
    name: item.name,
    value: Math.max(0, item.value),
    color: item.color,
  }));
}

export function buildFocusDistribution(
  dimension: FocusDimension,
  source: {
    categories: readonly CategoryDistItem[];
    applications: readonly TopApplicationItem[];
    items: readonly TodayItemRow[];
  },
): FocusDistribution {
  const slices = dimension === "category"
    ? fromCategories(source.categories)
    : dimension === "app"
      ? fromApplications(source.applications)
      : fromItems(source.items);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return { dimension, slices, total };
}
