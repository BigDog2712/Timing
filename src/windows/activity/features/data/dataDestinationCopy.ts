/**
 * 数据页「趋势区」的文案（[0.12.4] 从 `Data.tsx` 抽出的纯派生）。
 *
 * 三种目的地（应用 / 分类 / 网页）共用同一个面板，只有标题、空态、占位符这些**字符串**
 * 不同。以前它们在组件里写成 46 行嵌套三元，读的人要来回对照才知道哪个分支属于谁；
 * 抽成一张表之后，组件里只剩 `copy.title` 这样的引用，"哪一句给哪个维度"一眼可查。
 *
 * 纯函数、不读 hook、不看 locale —— 传进来的 `UiText` 已经是当前语言的成品。
 */
import type { UiText } from "../../shared/i18n/index.ts";

export interface DestinationCopy {
  title: string;
  rangeAriaLabel: string;
  searchPlaceholder: string;
  listAriaLabel: string;
  emptyLabel: string;
  noMatchLabel: string;
  totalMetricLabel: string;
  usageMetricLabel: string;
  interactionHint: string;
  heatmapTitle: string;
}

export function destinationCopy(
  text: UiText,
  web: boolean,
  category: boolean,
): DestinationCopy {
  const data = text.data;
  const accessibility = text.accessibility.data;
  if (web) {
    return {
      title: data.webTrend,
      rangeAriaLabel: accessibility.webTrendRange,
      searchPlaceholder: data.webSearchPlaceholder,
      listAriaLabel: data.webTrendDomainList,
      emptyLabel: data.webTrendEmpty,
      noMatchLabel: data.webTrendNoMatch,
      totalMetricLabel: data.webTrendTotal,
      usageMetricLabel: data.webTrendUsage,
      /* 网页维度没有标签编辑：双击是进详情，提示语与"看"的那一档一致。 */
      interactionHint: data.interactionHint,
      heatmapTitle: data.webHeatmap,
    };
  }
  if (category) {
    return {
      title: data.categoryTrend,
      rangeAriaLabel: accessibility.categoryTrendRange,
      searchPlaceholder: data.categorySearchPlaceholder,
      listAriaLabel: data.categoryTrendCategoryList,
      emptyLabel: data.categoryTrendEmpty,
      noMatchLabel: data.categoryTrendNoMatch,
      totalMetricLabel: data.appTrendTotal,
      usageMetricLabel: data.categoryTrend,
      interactionHint: data.categoryInteractionHint,
      heatmapTitle: data.categoryHeatmap,
    };
  }
  return {
    title: data.appTrend,
    rangeAriaLabel: accessibility.appTrendRange,
    searchPlaceholder: data.appSearchPlaceholder,
    listAriaLabel: data.appTrendAppList,
    emptyLabel: data.appTrendEmpty,
    noMatchLabel: data.appTrendNoMatch,
    totalMetricLabel: data.appTrendTotal,
    usageMetricLabel: data.appTrendUsage,
    interactionHint: data.interactionHint,
    heatmapTitle: data.appHeatmap,
  };
}
