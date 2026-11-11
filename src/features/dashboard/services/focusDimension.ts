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

function fromApplications(apps: readonly TopApplicationItem[]): FocusSlice[] {
  return apps.map((app) => ({
    key: app.exeName,
    name: app.name,
    value: Math.max(0, app.duration),
    color: app.color,
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
