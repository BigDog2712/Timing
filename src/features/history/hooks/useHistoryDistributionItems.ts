import { useMemo } from "react";

import { objectColor } from "../../../shared/classification/objectColor.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";
import type { UiText } from "../../../shared/i18n/index.ts";
import { buildWebDomainDistribution } from "../../../shared/lib/webActivityViewModel.ts";
import type { NormalizedAppSummaryItem } from "../../../shared/lib/sessionReadCompiler.ts";
import type { WebActivitySegment, WebDomainOverride } from "../../../shared/types/webActivity.ts";
import {
  createQuickAppClassificationTarget,
  createQuickWebClassificationTarget,
} from "../../classification/types.ts";
import { buildHistoryCategoryDistribution } from "../services/historyFormatting.ts";
import type { HistoryDayDistributionItem } from "../components/HistoryDayDistributionPanel.tsx";

/**
 * 历史页「时段分布」的三个数据源（应用 / 类别 / 网页）。
 *
 * 从 `History.tsx:648-725` **原样搬出**（P0-02 前置抽取）：那个文件冻结在 1206 行、
 * 零余量，接新功能前必须先等量腾出空间。本次搬移不改任何取数逻辑——三个 `useMemo`
 * 的依赖数组原样变成 hook 的入参，判定顺序、`void mappingVersion`（用来把「分类映射变了」
 * 显式钉进依赖）都保持原样。
 *
 * 为什么不拆成三个 hook：它们的入参高度重叠（`appSummary` / `UI_TEXT` / `webActivityEnabled`），
 * 拆开会让 `History.tsx` 多出三次调用与三份依赖列表，反而更占行数。
 */
export interface HistoryDistributionItemsParams {
  appSummary: NormalizedAppSummaryItem[];
  historyIcons: Record<string, string>;
  iconThemeColors: Record<string, string>;
  /** 分类映射版本：变了必须重算颜色与快捷分类目标（`void` 掉是为了留在依赖里） */
  mappingVersion: number;
  uiText: UiText;
  visibleDayWebSegments: WebActivitySegment[];
  selectedDayRange: { startMs: number; endMs: number };
  nowMs: number;
  webActivityEnabled: boolean;
  webDomainOverrides: Record<string, WebDomainOverride>;
  webDomainIconThemeColors: Record<string, string>;
  webDomainFavicons: Record<string, string>;
}

export interface HistoryDistributionItems {
  appItems: HistoryDayDistributionItem[];
  categoryItems: HistoryDayDistributionItem[];
  webItems: HistoryDayDistributionItem[];
}

/** 「某个应用该叫什么」：用户改名 > 原始 app_name > 分类映射名；匿名活动统一成「匿名活动」。 */
function historyAppDisplayName(exeName: string, appName: string, uiText: UiText) {
  const mapped = AppClassification.mapApp(exeName, { appName });
  return mapped.category === "anonymous" ? uiText.common.anonymousActivity
    : AppClassification.getUserOverride(exeName)?.displayName?.trim() || appName.trim() || mapped.name;
}

export function useHistoryDistributionItems({
  appSummary,
  historyIcons,
  iconThemeColors,
  mappingVersion,
  uiText,
  visibleDayWebSegments,
  selectedDayRange,
  nowMs,
  webActivityEnabled,
  webDomainOverrides,
  webDomainIconThemeColors,
  webDomainFavicons,
}: HistoryDistributionItemsParams): HistoryDistributionItems {
  const appItems = useMemo<HistoryDayDistributionItem[]>(
    () => {
      void mappingVersion;
      return appSummary.map((app) => {
        const mapped = AppClassification.mapApp(app.exeName, { appName: app.appName });
        const appOverride = AppClassification.getUserOverride(app.exeName);
        const overrideColor = appOverride?.color;
        const accentColor = objectColor("app", app.exeName, overrideColor, iconThemeColors[app.exeName], mapped.category, mapped.color);
        const appName = historyAppDisplayName(app.exeName, app.appName, uiText);
        return {
          key: app.exeName,
          label: appName,
          duration: app.duration,
          percentage: app.percentage,
          color: accentColor,
          iconSrc: historyIcons[app.exeName],
          kind: "app",
          quickClassificationTarget: mapped.category === "anonymous" ? undefined : createQuickAppClassificationTarget({
            exeName: app.exeName,
            displayName: appName,
            category: mapped.category,
          }),
          unclassified: mapped.category === "other",
        };
      });
    },
    [appSummary, historyIcons, iconThemeColors, mappingVersion, uiText],
  );

  const categoryItems = useMemo<HistoryDayDistributionItem[]>(() => {
    return buildHistoryCategoryDistribution(appSummary, (app) => {
      const mapped = AppClassification.mapApp(app.exeName, { appName: app.appName });
      return {
        category: mapped.category,
        label: AppClassification.getCategoryLabel(mapped.category, uiText),
        color: AppClassification.getCategoryColor(mapped.category),
      };
    });
  }, [appSummary, uiText]);

  const webItems = useMemo<HistoryDayDistributionItem[]>(
    () => {
      if (!webActivityEnabled) return [];

      return buildWebDomainDistribution(
        visibleDayWebSegments,
        selectedDayRange,
        nowMs,
        webDomainOverrides,
        webDomainIconThemeColors,
        webDomainFavicons,
      )
        .map((item) => ({
          key: item.key,
          label: item.category === "anonymous" ? uiText.common.anonymousActivity : item.label,
          duration: item.duration,
          percentage: item.percentage,
          color: item.color,
          iconSrc: item.faviconUrl ?? undefined,
          category: item.category,
          kind: "web" as const,
          quickClassificationTarget: item.category === "anonymous" ? undefined : createQuickWebClassificationTarget({
            normalizedDomain: item.key,
            displayName: item.label,
            category: item.category,
          }),
          unclassified: item.category === "other",
        }));
    },
    [
      nowMs,
      visibleDayWebSegments,
      selectedDayRange,
      webActivityEnabled,
      webDomainFavicons,
      webDomainIconThemeColors,
      webDomainOverrides,
      uiText,
    ],
  );

  return { appItems, categoryItems, webItems };
}
