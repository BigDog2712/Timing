import type {
  PomodoroPhase,
  PomodoroStatus,
  ReminderRecurrence,
  ReminderStatus,
  ToolAlertKind,
} from "../../shared/types/tools.ts";
import type { RawFreeFocusTask } from "./freeFocusRawDto.ts";

export interface RawToolRuntimeSettings {
  pomodoro_focus_minutes: number;
  pomodoro_short_break_minutes: number;
  pomodoro_long_break_minutes: number;
  pomodoro_long_break_every: number;
}

export interface RawToolReminder {
  id: number;
  label: string;
  scheduled_at: number;
  created_at: number;
  status: ReminderStatus;
  fired_at: number | null;
  cancelled_at: number | null;
  recurrence?: ReminderRecurrence | null;
}

export type RawActivityReminderTarget =
  | { kind: "app"; app_name: string; exe_name: string | null }
  | { kind: "category"; category_id: string }
  | { kind: "web"; normalized_domain: string };

export interface RawToolActivityReminderRule {
  id: number;
  enabled: boolean;
  target: RawActivityReminderTarget;
  label_snapshot: string;
  limit_ms: number;
  message: string;
  created_at: number;
  updated_at: number;
  disabled_at: number | null;
  last_fired_date_key: string | null;
  suspension_reason: "source_disabled" | "target_excluded" | "target_deleted" | null;
}

export interface RawToolPomodoroRun {
  id: number;
  phase: PomodoroPhase;
  status: PomodoroStatus;
  cycle_index: number;
  focus_ms: number;
  short_break_ms: number;
  long_break_ms: number;
  long_break_every: number;
  phase_started_at: number | null;
  phase_paused_at: number | null;
  phase_remaining_ms: number | null;
  completed_focus_count: number;
  created_at: number;
  updated_at: number;
}

export interface RawToolPomodoroTask {
  label: string;
  completed_groups: number;
  run: RawToolPomodoroRun;
}

export interface RawToolAlert {
  free_focus?: RawFreeFocusTask | null;
  pomodoro?: RawToolPomodoroTask | null;
  id: string;
  kind: ToolAlertKind;
  title: string;
  body: string;
  occurred_at: number;
  activity_reminder?: {
    rule_id: number;
    date_key: string;
    target: RawActivityReminderTarget;
    target_label: string;
    usage_ms: number;
    limit_ms: number;
    message: string;
  } | null;
}

export interface RawToolsRuntimeSnapshot {
  free_focus_tasks: RawFreeFocusTask[];
  pomodoro_tasks: RawToolPomodoroTask[];
  settings: RawToolRuntimeSettings;
  reminders: RawToolReminder[];
  activity_reminder_rules: RawToolActivityReminderRule[];
  current_pomodoro: RawToolPomodoroRun | null;
  today_completed_pomodoros: number;
  next_reminder_at: number | null;
  sampled_at_ms: number;
}
