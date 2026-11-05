/**
 * Timing — 移动端待办行：计时中不给「开始」按钮
 * -----------------------------------------------------------------------------
 * 这里只钉一件事（本轮修复的可见后果）：
 *   这条待办对应的事项**正在计时**时，右侧不该是「开始」——切给自己没有意义，
 *   点了只会收到 TIMER_ALREADY_RUNNING。改为同槽位的静态「计时中」标记。
 * 其余行为（圆圈 / 长按删除 / 时间文案）由 `lib/todoTimeLabel` 与真机手测覆盖。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Todo } from '../../types/domain';
import { TodoRowMobile } from './TodoRowMobile';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime();

function makeTodo(over: Partial<Todo> = {}): Todo {
  return {
    id: 3,
    title: '写周报',
    itemId: null,
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

let container: HTMLDivElement;
let root: Root;

async function mount(ui: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** `canStart=false` = 调用方不给这个入口（已完成区就是这么用的） */
function renderRow(todo: Todo, active: boolean, canStart = true, paused = false) {
  const handlers = {
    onToggle: vi.fn<(done: boolean) => void>(),
    onStart: vi.fn<() => void>(),
    onDelete: vi.fn<() => void>(),
  };
  const ui = createElement(TodoRowMobile, {
    todo,
    now: NOW,
    active,
    onToggle: handlers.onToggle,
    ...(canStart ? { onStart: handlers.onStart } : {}),
    onDelete: handlers.onDelete,
    paused,
  });
  return { handlers, ui };
}

/** 右槽位的可点「开始」按钮（`m-btn--accent` 只给这一个动作留着） */
const startBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.m-btn--accent');

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('计时中的待办行', () => {
  it('未在计时 → 有「开始」按钮，点了就调 onStart', async () => {
    const { ui, handlers } = renderRow(makeTodo(), false);
    const el = await mount(ui);

    expect(startBtn(el)?.textContent).toBe('开始');
    await click(startBtn(el));
    expect(handlers.onStart).toHaveBeenCalledTimes(1);
  });

  it('正在计时 → 不渲染可点的「开始」，只给静态「计时中」', async () => {
    const { ui, handlers } = renderRow(makeTodo(), true);
    const el = await mount(ui);

    expect(startBtn(el), '计时中的待办不该再有开始按钮').toBeNull();
    const live = el.querySelector('.m-todo__live');
    expect(live?.textContent).toBe('计时中');
    /* 静态标记：必须不是 button（否则等于换了个名字的按钮），
       但要带 role="status"——它在 idle⇄running⇄paused 之间换字，是 live region */
    expect(live?.tagName).toBe('SPAN');
    expect(live?.getAttribute('role')).toBe('status');
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  it('会话已暂停 → 标记文案是「已暂停」，不再让人以为秒表还在走（P2-5）', async () => {
    const { ui } = renderRow(makeTodo(), true, true, true);
    const el = await mount(ui);

    const live = el.querySelector('.m-todo__live');
    expect(live?.textContent).toBe('已暂停');
    expect(live?.getAttribute('role')).toBe('status');
    expect(startBtn(el)).toBeNull();
  });

  it('已完成 + 没传 onStart（事项页的已完成区）→ 不渲染「开始」', async () => {
    const { ui } = renderRow(makeTodo({ doneAt: NOW }), false, false);
    const el = await mount(ui);

    /* 后端 `todo_start` 对已完成待办只回 TODO_NOT_FOUND：这个按钮不该存在 */
    expect(startBtn(el)).toBeNull();
    expect(el.querySelector('.m-todo__live')).toBeNull();
  });

  it('已完成即便传了 onStart 也不给（勾完了就不该再开计时）', async () => {
    const { ui } = renderRow(makeTodo({ doneAt: NOW }), false);
    const el = await mount(ui);

    expect(startBtn(el)).toBeNull();
    expect(el.querySelector('.m-todo__live')).toBeNull();
  });

  it('未完成但没传 onStart → 也不渲染按钮（入口由调用方决定，不是写死的）', async () => {
    const { ui, handlers } = renderRow(makeTodo(), false, false);
    const el = await mount(ui);

    expect(startBtn(el)).toBeNull();
    expect(handlers.onStart).not.toHaveBeenCalled();
  });
});
