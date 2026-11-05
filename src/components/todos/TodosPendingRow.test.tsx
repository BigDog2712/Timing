/**
 * Timing — 待办行交互回归（V0.3.13 就地打字 / V0.3.14 语气 / ADR-034 时间列文案）
 * 只读：时间列文案 + `title` / 圆圈状态 / 整行开关提醒 / 点圆圈完成 / 逾期语气。
 * 编辑：名字与时间都原地打字（`09:00` / `明天 09:00`），清空即清空；编辑时点行不改提醒。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatClockTime } from '../../lib/format';
import type { TodoTimeField } from '../../lib/todoTimes';
import type { Todo } from '../../types/domain';
import { TodosPendingRow } from './TodosPendingRow';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime(); // 2026-10-20 09:00 本地
const HOUR = 3_600_000;

function makeTodo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    title: '写周报',
    itemId: null,
    plannedAt: null,
    remindAt: null,
    remindedAt: null, doneAt: null,
    sortOrder: 1,
    createdAt: 0, updatedAt: 0,
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

async function press(el: Element, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  });
}

/** 往受控输入框里打字（React 19 需要原生 setter + input 事件） */
async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function renderRow(todo: Todo, editMode: boolean) {
  const handlers = {
    onToggle: vi.fn<(done: boolean) => void>(),
    onSubmitRename: vi.fn<(title: string) => void>(),
    onDelete: vi.fn<() => void>(),
    onChangeTime: vi.fn<(field: TodoTimeField, ms: number | null) => string | null>(() => null),
    onEditError: vi.fn<(message: string) => void>(),
  };
  const ui = createElement(TodosPendingRow, {
    todo,
    now: NOW,
    editMode,
    onToggle: handlers.onToggle,
    onSubmitRename: handlers.onSubmitRename,
    onDelete: handlers.onDelete,
    onChangeTime: handlers.onChangeTime,
    onEditError: handlers.onEditError,
  });
  return { handlers, ui };
}

const mark = (el: HTMLElement) => el.querySelector('.todo-pend__mark');
const cell = (el: HTMLElement) => el.querySelector('.todo-pend__time');
const chip = (el: HTMLElement, field: TodoTimeField) =>
  el.querySelector<HTMLButtonElement>(`button.todo-pend__chip[data-field="${field}"]`);

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('只读：时间列（ADR-034 文案分级）', () => {
  it('开始时间优先；两者都没有就留白，且不带 title', async () => {
    const prefer = await mount(
      renderRow(makeTodo({ remindAt: NOW + HOUR, plannedAt: NOW + 3 * HOUR }), false).ui,
    );
    expect(cell(prefer)?.textContent).toBe(formatClockTime(NOW + HOUR));
    expect(cell(prefer)?.getAttribute('title')).toBe('2026-10-20 10:00');

    const blank = await mount(renderRow(makeTodo(), false).ui);
    expect(cell(blank)?.textContent).toBe('');
    expect(cell(blank)?.hasAttribute('title')).toBe(false);
  });

  it('未来的待办写日期 MM-DD，逾期写「逾期」，title 兜住完整时间', async () => {
    const tomorrow = new Date(2026, 9, 21, 9, 0, 0, 0).getTime();
    const future = await mount(renderRow(makeTodo({ plannedAt: tomorrow }), false).ui);
    expect(cell(future)?.textContent).toBe('10-21');
    expect(cell(future)?.getAttribute('title')).toBe('2026-10-21 09:00');

    const overdue = await mount(renderRow(makeTodo({ plannedAt: NOW - HOUR }), false).ui);
    expect(cell(overdue)?.textContent).toBe('逾期');
    expect(cell(overdue)?.getAttribute('title')).toBe('2026-10-20 08:00');
  });

  it('今天的待办仍是 HH:MM（与「今日计时」行同一套读数）', async () => {
    const el = await mount(renderRow(makeTodo({ plannedAt: NOW + HOUR }), false).ui);
    expect(cell(el)?.textContent).toBe(formatClockTime(NOW + HOUR));
    expect(cell(el)?.getAttribute('title')).toBe('2026-10-20 10:00');
  });
});

describe('只读：圆圈与整行', () => {
  it('圆圈只表达提醒：有 remindAt = 黄，没有 = 无色', async () => {
    const on = await mount(renderRow(makeTodo({ remindAt: NOW }), false).ui);
    expect(mark(on)?.getAttribute('data-on')).toBe('true');
    const off = await mount(renderRow(makeTodo(), false).ui);
    expect(mark(off)?.getAttribute('data-on')).toBe('false');
  });

  it('点圆圈 = 完成，不动提醒', async () => {
    const { ui, handlers } = renderRow(makeTodo({ remindAt: NOW }), false);
    const el = await mount(ui);
    await click(mark(el));
    expect(handlers.onToggle).toHaveBeenCalledWith(true);
    expect(handlers.onChangeTime).not.toHaveBeenCalled();
  });

  it('点整行 = 关提醒 / 借截止打开提醒 / 无时刻则弹选择器', async () => {
    const on = renderRow(makeTodo({ remindAt: NOW }), false);
    const elOn = await mount(on.ui);
    await click(elOn.querySelector('.todo-pend'));
    expect(on.handlers.onChangeTime).toHaveBeenCalledWith('remind', null);

    const borrow = renderRow(makeTodo({ plannedAt: NOW + HOUR }), false);
    const elBorrow = await mount(borrow.ui);
    await click(elBorrow.querySelector('.todo-pend'));
    expect(borrow.handlers.onChangeTime).toHaveBeenCalledWith('remind', NOW + HOUR);

    const blank = renderRow(makeTodo(), false);
    const elBlank = await mount(blank.ui);
    await click(elBlank.querySelector('.todo-pend'));
    expect(blank.handlers.onChangeTime).not.toHaveBeenCalled();
    expect(document.querySelector('.dt-pop'), '没有时刻可借用时应先让人选').not.toBeNull();
  });

  it('已完成的行点整行不动作', async () => {
    const { ui, handlers } = renderRow(makeTodo({ doneAt: NOW, remindAt: NOW }), false);
    const el = await mount(ui);
    await click(el.querySelector('.todo-pend'));
    expect(handlers.onChangeTime).not.toHaveBeenCalled();
  });
});

describe('编辑模式：点哪改哪，直接打字', () => {
  it('点名字 → 原地输入框 → Enter 提交改名', async () => {
    const { ui, handlers } = renderRow(makeTodo(), true);
    const el = await mount(ui);

    await click(el.querySelector('.todo-pend__title--editable'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text');
    expect(input).not.toBeNull();
    expect(input?.value).toBe('写周报');

    await typeInto(input!, '写月报');
    await press(input!, 'Enter');
    expect(handlers.onSubmitRename).toHaveBeenCalledWith('写月报');
  });

  it('名字清空 → 被拒、保持编辑态并提示', async () => {
    const { ui, handlers } = renderRow(makeTodo(), true);
    const el = await mount(ui);
    await click(el.querySelector('.todo-pend__title--editable'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;

    await typeInto(input, '   ');
    await press(input, 'Enter');
    expect(handlers.onSubmitRename).not.toHaveBeenCalled();
    expect(handlers.onEditError).toHaveBeenCalled();
    expect(el.querySelector('input.inline-text')).not.toBeNull();
  });

  it('点开启时间 → 输入框预填 HH:MM → 输入新时间提交', async () => {
    const { ui, handlers } = renderRow(makeTodo({ remindAt: NOW + HOUR }), true);
    const el = await mount(ui);

    await click(chip(el, 'remind'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text');
    expect(input?.value).toBe(formatClockTime(NOW + HOUR));

    await typeInto(input!, '10:30');
    await press(input!, 'Enter');
    expect(handlers.onChangeTime).toHaveBeenCalledTimes(1);
    const [field, ms] = handlers.onChangeTime.mock.calls[0];
    expect(field).toBe('remind');
    expect(formatClockTime(ms as number)).toBe('10:30');
  });

  it('支持「明天 09:00」这种写法', async () => {
    const { ui, handlers } = renderRow(makeTodo(), true);
    const el = await mount(ui);
    await click(chip(el, 'planned'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;

    await typeInto(input, '明天 09:00');
    await press(input, 'Enter');
    const [field, ms] = handlers.onChangeTime.mock.calls[0];
    expect(field).toBe('planned');
    expect(new Date(ms as number).getDate()).toBe(21);
  });

  it('清空即清空该项时间', async () => {
    const { ui, handlers } = renderRow(makeTodo({ remindAt: NOW }), true);
    const el = await mount(ui);
    await click(chip(el, 'remind'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;

    await typeInto(input, '');
    await press(input, 'Enter');
    expect(handlers.onChangeTime).toHaveBeenCalledWith('remind', null);
  });

  it('写不清楚的时间 → 不提交，报错并保持编辑', async () => {
    const { ui, handlers } = renderRow(makeTodo(), true);
    const el = await mount(ui);
    await click(chip(el, 'remind'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;

    await typeInto(input, '下午三点');
    await press(input, 'Enter');
    expect(handlers.onChangeTime).not.toHaveBeenCalled();
    expect(handlers.onEditError).toHaveBeenCalled();
    expect(el.querySelector('input.inline-text')).not.toBeNull();
  });

  it('编辑模式下行点击不再切提醒', async () => {
    const { ui, handlers } = renderRow(makeTodo({ remindAt: NOW }), true);
    const el = await mount(ui);
    await click(el.querySelector('.todo-pend'));
    expect(handlers.onChangeTime).not.toHaveBeenCalled();
  });
});

describe('语气（V0.3.14）', () => {
  it('未完成且截止已过 → overdue（透明度 + 横线由 CSS 承担）', async () => {
    const el = await mount(renderRow(makeTodo({ plannedAt: NOW - HOUR }), false).ui);
    expect(el.querySelector('.todo-pend')?.getAttribute('data-tone')).toBe('overdue');
  });

  it('已完成的行不判逾期；只设开始时间的行是常规语气', async () => {
    const done = await mount(
      renderRow(makeTodo({ plannedAt: NOW - HOUR, doneAt: NOW }), false).ui,
    );
    expect(done.querySelector('.todo-pend')?.getAttribute('data-tone')).toBe('normal');
    const remindOnly = await mount(renderRow(makeTodo({ remindAt: NOW + HOUR }), false).ui);
    expect(remindOnly.querySelector('.todo-pend')?.getAttribute('data-tone')).toBe('normal');
  });
});

describe('键盘', () => {
  it('Space 完成 / R 开关提醒 / Delete 删除', async () => {
    const { ui, handlers } = renderRow(makeTodo({ remindAt: NOW }), false);
    const el = await mount(ui);
    const row = el.querySelector('.todo-pend')!;

    await press(row, ' ');
    expect(handlers.onToggle).toHaveBeenCalledWith(true);

    await press(row, 'r');
    expect(handlers.onChangeTime).toHaveBeenCalledWith('remind', null);

    await press(row, 'Delete');
    expect(handlers.onDelete).toHaveBeenCalledTimes(1);
  });
});
