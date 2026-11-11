/**
 * [P2 · 0.12.1] 专注窗口的**三个维度**：分类 / 应用 / 窗口标题。
 *
 * 为什么第三维叫「窗口标题」而不叫「事项」：分析窗里能拿到的事实是
 * `CompiledSession.displayTitle`（窗口标题，`buildTopItems` 早就在按它聚合），而 Timing 的
 * 「事项」是另一张 `items` 表、要走宿主命令才读得到。两个东西同名不同源，混叫会让用户
 * 拿着一份名字对、数字不对的图。（这条与 `docs/design/PLAN-…` §5.3 的口径一致：
 * 默认取 `items` 表，在没有该数据源前，界面上必须叫它本来的名字。）
 *
 * 三个维度都从**同一批 stats / sessions** 派生，所以总量必须自洽：
 *   分类 Σ = stats Σ = 应用 Σ（同一份 AppStat 两种分组）
 *   标题 Σ ≤ 上面的和（无标题会话不进标题维度 —— 不是少算，是那个维度不存在这一行）
 */
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler.ts";
import { buildTopItems } from "./dashboardFormatting.ts";
import type { CategoryDistItem, TopApplicationItem } from "./dashboardFormatting.ts";

export const FOCUS_DIMENSIONS = ["category", "app", "title"] as const;
export type FocusDimension = (typeof FOCUS_DIMENSIONS)[number];

export interface FocusSlice {
  /** 稳定 key（维度内唯一）：分类用枚举值，应用用 exeName，标题用标题原文。 */
  key: string;
  /** 展示名。分类维度留空，由组件按 `category` 查 i18n 词条补齐（既有口径）。 */
  name: string;
  value: number;
  color: string;
  /** 只有分类维度有；环上的「匿名活动」纹理与词条补全都靠它。 */
  category?: AppCategory;
}

export interface FocusDistribution {
  dimension: FocusDimension;
  slices: FocusSlice[];
  total: number;
}

export function isFocusDimension(value: unknown): value is FocusDimension {
  return value === "category" || value === "app" || value === "title";
}

/** 应用维度：`TopApplicationItem` 已经是按应用聚合好的，直接换形。 */
function fromApplications(apps: readonly TopApplicationItem[]): FocusSlice[] {
  return apps.map((app) => ({
    key: app.exeName,
    name: app.name,
    value: Math.max(0, app.duration),
    color: app.color,
  }));
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

/** 标题维度：沿用 `buildTopItems`（它就是按 `displayTitle` 聚合的），颜色取该标题的主应用。 */
function fromTitles(sessions: readonly CompiledSession[], apps: readonly TopApplicationItem[], limit: number): FocusSlice[] {
  const colorByApp = new Map(apps.map((app) => [app.exeName, app.color]));
  const dominantApp = new Map<string, string>();
  for (const session of sessions) {
    const title = (session.displayTitle || session.displayName || "").trim();
    if (!title || dominantApp.has(title)) continue;
    dominantApp.set(title, session.exeName ?? "");
  }

  return buildTopItems([...sessions], limit).items.map((item) => ({
    key: item.title,
    name: item.title,
    value: Math.max(0, item.duration),
    color: colorByApp.get(dominantApp.get(item.title) ?? "") ?? "",
  }));
}

export function buildFocusDistribution(
  dimension: FocusDimension,
  source: {
    categories: readonly CategoryDistItem[];
    applications: readonly TopApplicationItem[];
    sessions: readonly CompiledSession[];
  },
  limit = 6,
): FocusDistribution {
  const slices = dimension === "category"
    ? fromCategories(source.categories)
    : dimension === "app"
      ? fromApplications(source.applications)
      : fromTitles(source.sessions, source.applications, limit);

  const total = slices.reduce((sum, slice) => sum + slice.value, 0);
  return { dimension, slices, total };
}
