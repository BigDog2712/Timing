import type { Locale } from "../../../shared/i18n/index.ts";
import type { ActivityReminderRuleRowViewModel } from "../../tools/types.ts";
import { formatUsageDuration } from "../../tools/services/toolsLabels.ts";
import type { ToolsRuntimeSnapshot } from "../../../shared/types/tools.ts";

/**
 * [T04] 活动提醒规则行的展示构造（唯一实现，`useActivityReminders` 消费）。
 *
 * 原实现在随工具页整批删除的 `features/tools/services/toolsViewModel.ts` 里，这里
 * 只搬 `buildActivityReminderRuleRows` 这一个函数——它是新活动提醒卡唯一的幸存消费者。
 * 逐字搬运，语义零变更；`formatUsageDuration` 仍从保留的 `toolsLabels.ts` 取。
 */

const MS_PER_MINUTE = 60_000;

export function buildActivityReminderRuleRows(
  snapshot: ToolsRuntimeSnapshot,
  locale: Locale,
): ActivityReminderRuleRowViewModel[] {
  return snapshot.activityReminderRules.map((rule) => {
    const limitMinutes = Math.max(1, Math.round(rule.limitMs / MS_PER_MINUTE));
    const targetLabel = rule.labelSnapshot
      || (rule.target.kind === "app"
        ? rule.target.appName
        : rule.target.kind === "category"
          ? rule.target.categoryId
          : rule.target.normalizedDomain);
    return {
      id: rule.id,
      enabled: rule.enabled,
      limitMinutes,
      kind: rule.target.kind,
      targetKey: rule.target.kind === "app"
        ? (rule.target.exeName ?? rule.target.appName)
        : rule.target.kind === "category"
          ? rule.target.categoryId
          : rule.target.normalizedDomain,
      targetLabel,
      exeName: rule.target.kind === "app" ? rule.target.exeName : null,
      limitLabel: formatUsageDuration(limitMinutes, locale),
      message: rule.message,
      suspensionReason: rule.suspensionReason,
    };
  });
}
