import type { ReminderRecurrence, ActivityReminderTarget, PomodoroPhase, ReminderStatus } from "../../shared/types/tools.ts";

export type ToolsSection = "reminders" | "pomodoro";
export type ReminderMode = "event" | "usage";
export type ReminderFormMode = "relative" | "absolute";

export interface ToolsOpenTarget {
  /** 省略 = 「进工具面、不指定分区」（顶栏工具入口门 §5.3）——落回工具面自己记住的分区。
   *  任何带分区的调用（灯、药丸、托盘）都照旧必须写。 */
  section?: ToolsSection;
}

export interface ToolStatusChipViewModel {
  label: string;
  targetSection: ToolsSection;
}

export interface ReminderRowViewModel {
  id: number;
  label: string;
  dueLabel: string;
  scheduledAt: number;
  status: ReminderStatus;
  recurrence: ReminderRecurrence | null;
}

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


export interface PomodoroViewModel {
  phase: PomodoroPhase;
  phaseLabel: string;
  remainingLabel: string;
  cycleLabel: string;
  todayCompletedLabel: string;
}

export interface ToolsViewModelLabels {
  pomodoroFocus: string;
  pomodoroShortBreak: string;
  pomodoroLongBreak: string;
  chipFocus: string;
  chipBreak: string;
  chipReminder: string;
  completedToday: (count: number) => string;
  cycle: (index: number, every: number) => string;
}
