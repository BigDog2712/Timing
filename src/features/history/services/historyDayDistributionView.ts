import type { UiText } from "../../../shared/i18n/index.ts";
import type { QuietSegmentedFilterOption } from "../../../shared/components/QuietSegmentedFilter";
import type { HistoryDayDistributionItem } from "../components/HistoryDayDistributionPanel.tsx";
import {
  resolveEffectiveDayDistributionMode,
  type DayDistributionMode,
} from "./historyLayoutPreferenceStorage.ts";

/**
 * 单日「时段分布」卡的模式解析（应用 / 分类 / 网页 三档）。
 *
 * 从 `History.tsx` 搬出来的：那份文件冻结在 1147 行，接区间视图前必须等量腾出空间。
 * 逻辑一字未改——`webActivityEnabled` 关掉时，已存的 `web` 偏好要被**降级**成 `app`，
 * 否则用户关掉网页追踪后再回历史页会看到一张空卡。
 */
export interface HistoryDayDistributionView {
  mode: DayDistributionMode;
  options: QuietSegmentedFilterOption<DayDistributionMode>[];
  items: HistoryDayDistributionItem[];
}

export function buildHistoryDayDistributionView({
  requestedMode,
  webActivityEnabled,
  appItems,
  categoryItems,
  webItems,
  text,
}: {
  requestedMode: DayDistributionMode;
  webActivityEnabled: boolean;
  appItems: HistoryDayDistributionItem[];
  categoryItems: HistoryDayDistributionItem[];
  webItems: HistoryDayDistributionItem[];
  text: UiText["history"];
}): HistoryDayDistributionView {
  const mode = resolveEffectiveDayDistributionMode(requestedMode, webActivityEnabled);
  const options: QuietSegmentedFilterOption<DayDistributionMode>[] = [
    { value: "app", label: text.distributionByApp },
    { value: "category", label: text.distributionByCategory },
  ];

  if (webActivityEnabled) {
    options.push({ value: "web", label: text.distributionByWeb });
  }

  return {
    mode,
    options,
    items: mode === "web" ? webItems : mode === "category" ? categoryItems : appItems,
  };
}
