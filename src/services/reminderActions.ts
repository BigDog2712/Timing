/**
 * Timing — 提醒动作（批2 N-5；菜单 / 托盘 / 后台事件 共用；唯一提醒口径）
 * -----------------------------------------------------------------------------
 * 语义边界（reminder-popover.md §3.1 边界）：**提醒 ≠ 结束计时**——提醒只「告知」，
 * 「到点自动结束并保存」归倒计时（countdown-menu）。
 *   - openSet(...)：小条/事项右键「提醒…」→ 弹设置卡。
 *   - onFired(...)：reminder-fired 事件 → **±60s 窗口聚合为单张卡**（AC-61）。
 *   - snooze(...)：「稍后提醒」→ 写新的 remind_at（走 reminder_set）。
 *   - clear(...)：清除某目标的提醒。
 *   - startNewTimer(...)：「开始新计时」（item 目标直接用该事项，其他用最近事项）。
 */
import { errorText, ipc } from './ipc';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import type { FiredReminderItem, MenuPos } from '../stores/uiStore';
import type { Reminder, ReminderTarget } from '../types/domain';

/** 聚合窗口（与 AC-61 / size.reminderMergeWindowMs 一致）：±60s */
const MERGE_WINDOW_MS = 60_000;

/** 浮出卡默认锚点（事件触发无鼠标位置时；贴近小条左上，与键盘菜单一致） */
const DEFAULT_ANCHOR: MenuPos = { x: 12, y: 56 };

/** 到点缓冲（模块级：跨事件累积，单张卡承载） */
let firedBuffer: FiredReminderItem[] = [];

function pruneBuffer(now: number): void {
  firedBuffer = firedBuffer.filter((f) => now - f.remindAt <= MERGE_WINDOW_MS);
}

export const reminderActions = {
  /** 打开设置卡（右键「提醒…」） */
  openSet(target: ReminderTarget, targetId: number, title: string, pos: MenuPos): void {
    useUiStore.getState().openReminderPopover({ pos, mode: 'set', target, targetId, title, remindAt: null });
  },

  /** 后台 reminder-fired → 聚合为单张到时卡（AC-61：不弹 N 张） */
  onFired(reminder: Reminder): void {
    const now = Date.now();
    pruneBuffer(now);
    firedBuffer.push({
      target: reminder.target,
      targetId: reminder.targetId,
      title: reminder.title,
      remindAt: reminder.remindAt,
    });
    useUiStore.getState().openReminderPopover({
      pos: DEFAULT_ANCHOR,
      mode: 'fired',
      target: reminder.target,
      targetId: reminder.targetId,
      title: reminder.title,
      fired: [...firedBuffer],
    });
  },

  /** 设置提醒（设置卡快捷项 / 稍后提醒统一入口） */
  async setRemindAt(target: ReminderTarget, targetId: number, remindAt: number): Promise<void> {
    try {
      await ipc.reminderSet({ target, targetId, remindAt });
      useUiStore.getState().closeReminderPopover();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
  },

  /** 清除提醒 */
  async clear(target: ReminderTarget, targetId: number): Promise<void> {
    try {
      await ipc.reminderClear({ target, targetId });
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
  },

  /** 「开始新计时」：item 目标用该事项，其余用最近事项 */
  async startNewTimer(reminder: { target: ReminderTarget; targetId: number }): Promise<void> {
    try {
      await ipc.startTimer(reminder.target === 'item' ? { itemId: reminder.targetId } : {});
      await useTimerStore.getState().refresh();
      useUiStore.getState().closeReminderPopover();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
  },

  close(): void {
    firedBuffer = [];
    useUiStore.getState().closeReminderPopover();
  },
};

/** 逐条清除某到点条目（AC-61 §3.5：逐条可清除，不弹阻塞框） */
export function clearFiredItem(index: number): void {
  const state = useUiStore.getState().reminderPopover;
  if (!state || state.mode !== 'fired' || !state.fired) return;
  const item = state.fired[index];
  if (!item) return;
  void reminderActions.clear(item.target, item.targetId);
  firedBuffer = firedBuffer.filter((f) => !(f.target === item.target && f.targetId === item.targetId));
  const next = state.fired.filter((_, i) => i !== index);
  if (next.length === 0) reminderActions.close();
  else useUiStore.getState().openReminderPopover({ ...state, fired: next });
}

/** 全部清除到点条目（AC-61 §3.5） */
export function clearAllFired(): void {
  const state = useUiStore.getState().reminderPopover;
  if (!state || state.mode !== 'fired' || !state.fired) return;
  for (const f of state.fired) void reminderActions.clear(f.target, f.targetId);
  reminderActions.close();
}
