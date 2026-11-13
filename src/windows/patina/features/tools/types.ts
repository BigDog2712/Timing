import type { ActivityReminderTarget } from "../../shared/types/tools.ts";

/**
 * 工具域的类型残表（[本轮 T04]）：工具页与灯簇整批下线后，本文件只剩
 * 活动提醒卡三件套（已搬迁到 `features/dashboard/components/reminder/`）与
 * 到点弹窗仍在用的 viewmodel。
 */
export interface ActivityReminderRuleRowViewModel {
  id: number;
  enabled: boolean;
  limitMinutes: number;
  kind: ActivityReminderTarget["kind"];
  targetKey: string;
  targetLabel: string;
  exeName: string | null;
  limitLabel: string;
  message: string;
  suspensionReason: "source_disabled" | "target_excluded" | "target_deleted" | null;
}
