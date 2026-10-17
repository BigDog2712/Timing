/**
 * TickBar — 浏览器降级 Mock：V0.2.0 新增命令处理器（23 个）
 * -----------------------------------------------------------------------------
 * 拆自 browserMock.ts（单文件 ≤300 行纪律）。**不参与生产**：Tauri 环境走 invoke。
 * 覆盖：待办域 5 · 便利贴域 5 · 多窗口域 4 · 主题域 4 · 倒计时 2 · 提醒域 3。
 */
import type { AccentColors, Item, Note, Reminder, ThemeMode, Todo } from '../types/domain';
import { MAX_COUNTDOWN_SEC } from '../types/domain';
import { fail, now, type MockState } from './mockSeed';

export function createMockApiV020(
  s: MockState,
  findItem: (id: number) => Item | undefined,
): Record<string, (args?: any) => unknown> {
  return {
    /* ---- 待办域 ---- */
    todo_create: (a) => {
      const title = String(a?.title ?? '').trim();
      if (!title || title.length > 200) fail('ITEM_NAME_EMPTY', '待办标题不能为空');
      const t = now();
      const todo: Todo = {
        id: ++s.seq,
        title,
        plannedAt: (a?.plannedAt as number | null) ?? null,
        remindAt: (a?.remindAt as number | null) ?? null,
        remindedAt: null,
        doneAt: null,
        sortOrder: s.todos.length,
        createdAt: t,
        updatedAt: t,
      };
      s.todos.push(todo);
      return todo;
    },
    todo_update: (a) => {
      const todo = s.todos.find((x) => x.id === a?.id);
      if (!todo) fail('TODO_NOT_FOUND', '待办不存在');
      const patch = (a?.patch ?? {}) as Partial<Todo>;
      if (patch.title !== undefined) todo.title = String(patch.title);
      if (patch.plannedAt !== undefined) todo.plannedAt = patch.plannedAt;
      if (patch.remindAt !== undefined) {
        todo.remindAt = patch.remindAt;
        todo.remindedAt = null;
      }
      if (patch.sortOrder !== undefined) todo.sortOrder = patch.sortOrder;
      todo.updatedAt = now();
      return todo;
    },
    todo_delete: (a) => {
      s.todos = s.todos.filter((x) => x.id !== a?.id);
      return undefined;
    },
    todo_list: (a) => {
      const includeDone = Boolean(a?.includeDone);
      const from = a?.from as number | undefined;
      const to = a?.to as number | undefined;
      let rows = s.todos.filter((x) => includeDone || x.doneAt == null);
      if (from != null) rows = rows.filter((x) => x.plannedAt != null && x.plannedAt >= from);
      if (to != null) rows = rows.filter((x) => x.plannedAt != null && x.plannedAt < to);
      return [...rows].sort((x, y) => x.sortOrder - y.sortOrder);
    },
    todo_toggle: (a) => {
      const todo = s.todos.find((x) => x.id === a?.id);
      if (!todo) fail('TODO_NOT_FOUND', '待办不存在');
      todo.doneAt = Boolean(a?.done) ? now() : null;
      todo.updatedAt = now();
      return todo;
    },

    /* ---- 便利贴域 ---- */
    note_create: (a) => {
      const t = now();
      const note: Note = {
        id: ++s.seq,
        itemId: (a?.itemId as number | undefined) ?? null,
        content: String(a?.content ?? ''),
        posX: Number(a?.posX ?? 0),
        posY: Number(a?.posY ?? 0),
        width: Number(a?.width ?? 320),
        height: Number(a?.height ?? 232),
        isOpen: false,
        createdAt: t,
        updatedAt: t,
      };
      s.notes.push(note);
      return note;
    },
    note_get: (a) => {
      const note = s.notes.find((x) => x.id === a?.id);
      if (!note) fail('NOTE_NOT_FOUND', '便利贴不存在');
      return note;
    },
    note_list: (a) => {
      const itemId = a?.itemId as number | undefined;
      return s.notes.filter((x) => itemId == null || x.itemId === itemId);
    },
    note_update: (a) => {
      const note = s.notes.find((x) => x.id === a?.id);
      if (!note) fail('NOTE_NOT_FOUND', '便利贴不存在');
      const patch = (a?.patch ?? {}) as Record<string, unknown>;
      (['itemId', 'content', 'posX', 'posY', 'width', 'height'] as const).forEach((key) => {
        if (patch[key] !== undefined) (note as unknown as Record<string, unknown>)[key] = patch[key];
      });
      note.updatedAt = now();
      return note;
    },
    note_delete: (a) => {
      if (!s.notes.some((x) => x.id === a?.id)) fail('NOTE_NOT_FOUND', '便利贴不存在');
      s.notes = s.notes.filter((x) => x.id !== a?.id);
      return undefined;
    },

    /* ---- 多窗口域（浏览器无窗口：no-op，不抛错） ---- */
    open_note_window: () => undefined,
    close_note_window: () => undefined,
    open_todos_window: () => undefined,
    open_settings_window: () => undefined,
    get_reference_settings: () => ({ uiScale: 1, plateOpacity: 0.9, defaultCountdownMinutes: 25, maxMinutes: 120, autoWriteOnStop: true, autoBindFirstTodo: false, defaultPauseReason: '', mergeGapMinutes: 5, minRecordSeconds: 5, pendingEnabled: true, remindAdvanceMinutes: 10, lightRemindDefaultOn: true, quickFindEnabled: true, timerWindowEnabled: false, extensionAutoStart: false, highlightColor: '#4DA3E8', desktopMenuEnabled: true }),
    update_reference_settings: (a) => a?.patch,

    /* ---- 主题域 ---- */
    theme_get: () => ({ mode: s.settings.themeMode }),
    theme_set: (a) => {
      const mode = a?.mode as ThemeMode;
      if (mode !== 'dark' && mode !== 'light' && mode !== 'system') fail('IO_ERROR', '非法主题模式');
      s.settings.themeMode = mode;
      return { mode };
    },
    accent_get: () => s.settings.accents,
    accent_set: (a) => {
      const hex = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
      const patch = (a?.patch ?? {}) as Partial<AccentColors>;
      (Object.keys(patch) as (keyof AccentColors)[]).forEach((key) => {
        const value = patch[key];
        if (value === undefined) return;
        if (value === null) {
          if (key === 'bar') s.settings.accents.bar = null;
          else fail('INVALID_COLOR', '颜色值不合法');
          return;
        }
        if (typeof value !== 'string' || !hex.test(value)) fail('INVALID_COLOR', '颜色值不合法');
        s.settings.accents[key] = value;
      });
      return s.settings.accents;
    },

    /* ---- 计时域 · 倒计时扩展 ---- */
    start_countdown: (a) => {
      const targetSec = Number(a?.targetSec);
      if (!Number.isFinite(targetSec) || targetSec <= 0 || targetSec > MAX_COUNTDOWN_SEC) {
        fail('INVALID_TARGET_SEC', '倒计时时长不合法');
      }
      if (s.active) fail('TIMER_ALREADY_RUNNING', '已有进行中的计时');
      const itemId = (a?.itemId as number | undefined) ?? 1;
      if (!findItem(itemId)) fail('ITEM_NOT_FOUND', '事项不存在');
      const t = now();
      s.active = {
        id: ++s.seq,
        itemId,
        status: 'active',
        startedAt: t,
        endedAt: null,
        accumulatedSec: 0,
        runningSince: t,
        note: null,
        mode: 'countdown',
        targetSec: Math.floor(targetSec),
      };
      s.lastItemId = itemId;
      return s.active;
    },
    set_countdown_preset: (a) => {
      const raw = Array.isArray(a?.presets) ? (a.presets as number[]) : [];
      const cleaned = [...new Set(raw.filter((n) => Number.isFinite(n) && n > 0).map((n) => Math.floor(n)))]
        .sort((x, y) => x - y)
        .slice(0, 8);
      if (cleaned.length === 0) fail('INVALID_TARGET_SEC', '预设不能为空');
      s.settings.countdownPresets = cleaned;
      return cleaned;
    },

    /* ---- 提醒域 ---- */
    reminder_set: (a) => {
      const target = a?.target as 'item' | 'todo';
      const targetId = Number(a?.targetId);
      const remindAt = Number(a?.remindAt);
      const title =
        target === 'todo'
          ? s.todos.find((x) => x.id === targetId)?.title
          : s.items.find((x) => x.id === targetId)?.name;
      if (!title) fail(target === 'todo' ? 'TODO_NOT_FOUND' : 'ITEM_NOT_FOUND', '目标不存在');
      const reminder: Reminder = { target, targetId, title, remindAt };
      s.reminders = s.reminders.filter((x) => !(x.target === target && x.targetId === targetId));
      s.reminders.push(reminder);
      return reminder;
    },
    reminder_clear: (a) => {
      s.reminders = s.reminders.filter((x) => !(x.target === a?.target && x.targetId === a?.targetId));
      return undefined;
    },
    reminder_pending: () => [...s.reminders].sort((x, y) => x.remindAt - y.remindAt),
  };
}
