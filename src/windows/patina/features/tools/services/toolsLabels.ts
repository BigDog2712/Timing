import type { Locale } from "../../../shared/i18n/index.ts";

/**
 * [本轮 T04] `buildToolsViewModelLabels` 随番茄 / 灯簇下线删除；
 * 只留 `formatUsageDuration`（活动提醒卡三件套 + 到点弹窗在用）。
 */
export function formatUsageDuration(totalMinutes: number, locale: Locale): string {
  const total = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  const unit = (value: number, name: "hour" | "minute") => new Intl.NumberFormat(locale, {
    style: "unit", unit: name, unitDisplay: "long",
  }).formatToParts(value).filter(part => part.type !== "literal").map(part => part.value).join(" ");
  return [hours ? unit(hours, "hour") : "", minutes || !hours ? unit(minutes, "minute") : ""].filter(Boolean).join(" ");
}
