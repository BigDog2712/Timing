/**
 * Timing — 待办两级提醒动作（V0.3.12 / ADR-030）
 * -----------------------------------------------------------------------------
 * 后台 `jobs::nudge` 每 15s 扫一次，命中后广播 `todo-nudge`：
 *   - `stage = 1` **轻提醒**（开始前 15 分钟）：浮出卡问「要不要改时间」——
 *     给时间不确定的待办用；改时间 = 整体平移 `remind_at`（后端会顺带把
 *     `remind_stage` 归零，于是两级提醒按新时刻重来）。
 *   - `stage = 2` **自动开始询问**（开始前 5 分钟）：问「当前事项结束后自动开始？」——
 *     答应 → `auto_start = 1`，本次会话一结束就顶上（`timer_stop` 的钩子）；
 *     也可以「现在就开始」，直接走 `todo_start`（开始即移出待办区）。
 * 同一时刻只承载一张卡（与 AC-61 的聚合思路一致）：新的 nudge 直接替换旧卡。
 */
import { errorText, ipc } from './ipc';
import { todoApi } from './api';
import { useTimerStore } from '../stores/timerStore';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';
import type { MenuPos } from '../stores/uiStore';
import type { TodoNudge } from '../types/domain';

/** 浮出卡默认锚点（贴近小条左上，与键盘菜单一致） */
const DEFAULT_ANCHOR: MenuPos = { x: 12, y: 56 };

/** 轻提醒的快捷平移档（用户口径「问是否要修改时间」——一拍就能改） */
export const NUDGE_SHIFTS: { label: string; ms: number }[] = [
  { label: '推迟 15 分钟', ms: 15 * 60_000 },
  { label: '推迟 1 小时', ms: 60 * 60_000 },
  { label: '推到明天此刻', ms: 24 * 60 * 60_000 },
];

function refreshTodos(): void {
  // 事项窗可能没在这个窗口挂着 store，失败无所谓（那边会自己重拉）
  void useTodoStore.getState().reload().catch(() => undefined);
}

export const todoNudgeActions = {
  onNudge(nudge: TodoNudge): void {
    useUiStore.getState().openReminderPopover({
      pos: DEFAULT_ANCHOR,
      mode: 'nudge',
      target: 'todo',
      targetId: nudge.todoId,
      title: nudge.title,
      remindAt: nudge.remindAt,
      nudge,
    });
  },

  /** 轻提醒：把开始时间整体平移（问「要不要改时间」的作答） */
  async postpone(nudge: TodoNudge, deltaMs: number): Promise<void> {
    try {
      await ipc.todoUpdate({ id: nudge.todoId, patch: { remindAt: nudge.remindAt + deltaMs } });
      refreshTodos();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
    useUiStore.getState().closeReminderPopover();
  },

  /** 「结束后自动开始」：记一条应允，等本次会话结束后由后端顶上 */
  async autoStart(nudge: TodoNudge): Promise<void> {
    try {
      await ipc.todoUpdate({ id: nudge.todoId, patch: { autoStart: true } });
      useUiStore.getState().setNotice({ text: `「${nudge.title}」将在当前计时结束后开始`, tone: 'info' });
      refreshTodos();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
    useUiStore.getState().closeReminderPopover();
  },

  /** 「现在就开始」：直接开计时，并把这条待办移出待办区 */
  async startNow(nudge: TodoNudge): Promise<void> {
    try {
      await todoApi.start(nudge.todoId);
      await useTimerStore.getState().refresh();
      refreshTodos();
    } catch (err) {
      useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
    }
    useUiStore.getState().closeReminderPopover();
  },

  /** 不改、也不开始：只收卡（提醒已置位，不会重复弹） */
  close(): void {
    useUiStore.getState().closeReminderPopover();
  },
};
