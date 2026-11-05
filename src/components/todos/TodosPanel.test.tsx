/**
 * Timing — 事项窗口面板「待办区显示范围」回归（ADR-034）
 * -----------------------------------------------------------------------------
 * 用户口径：「在事项组件右键唤起的事项菜单，待办事项区应保存为规定时间及规定在以后完成的
 * 待办事项」。ADR-032 时这里被 `filterToday` 限制成「只显示今天」，于是明天的、下周的待办
 * 在面板里**整条不可见**。这条测试钉住新口径：明天的待办必须出现在列表里（计数也跟着涨）。
 *
 * 只挂载面板本身，IPC 一律 mock：本用例关心的是「列表里有没有这一行」，
 * 不关心后端拿数据的过程（那些在 `todoPanelLists.test.ts` 里已用纯函数覆盖）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../../types/domain';

/** 明天 09:00（本地）——相对真实时钟算，避免测试随日期腐坏 */
function tomorrowAt9(): number {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.getTime();
}

function makeTodo(over: Partial<Todo>): Todo {
  return {
    id: 1,
    title: '待办',
    plannedAt: null,
    remindAt: null,
    remindedAt: null,
    doneAt: null,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const { ROWS } = vi.hoisted(() => ({
  ROWS: [] as unknown[],
}));

vi.mock('../../services/ipc', () => ({
  ipc: {
    statsSummary: async () => ({ totalSec: 0, recordCount: 0, byItem: [] }),
    listRecords: async () => ({ items: [], total: 0, page: 1, limit: 50, hasMore: false }),
    todoList: async () => ROWS,
    noteList: async () => [],
  },
  onIpcEvent: async () => () => undefined,
  errorText: (err: unknown) => String(err),
  IpcError: class IpcError extends Error {},
  isTauri: false,
}));

import { useTodoStore } from '../../stores/todoStore';
import { TodosPanel } from './TodosPanel';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  document.body.innerHTML = '';
  ROWS.length = 0;
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

async function mountPanel(todos: Todo[]): Promise<HTMLDivElement> {
  ROWS.splice(0, ROWS.length, ...todos);
  useTodoStore.setState({ todos, loading: false, loaded: true, error: null, commitError: null });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(TodosPanel, {}));
  });
  /* 面板挂载后会 reload 一次（IPC 已 mock 成同一批数据），等它收敛再断言 */
  await act(async () => {
    await Promise.resolve();
  });
  return container;
}

describe('待办区显示范围（ADR-034）', () => {
  it('明天的待办也出现在列表里，计数跟着算进去', async () => {
    const tomorrow = tomorrowAt9();
    const el = await mountPanel([
      makeTodo({ id: 1, title: '今天的事', plannedAt: Date.now() }),
      makeTodo({ id: 2, title: '明天的事', plannedAt: tomorrow, sortOrder: 2 }),
    ]);

    const titles = Array.from(el.querySelectorAll('.todo-pend__title')).map((n) => n.textContent);
    expect(titles).toEqual(['今天的事', '明天的事']);
    expect(el.querySelector('.todo-sec__label')?.textContent).toBe('待办事项 · 2');
  });

  it('未来待办的时间列写日期（MM-DD），不是 HH:MM', async () => {
    const tomorrow = tomorrowAt9();
    const el = await mountPanel([makeTodo({ id: 1, title: '明天的事', plannedAt: tomorrow })]);
    const d = new Date(tomorrow);
    const mmdd = `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    expect(el.querySelector('.todo-pend__time')?.textContent).toBe(mmdd);
  });
});
