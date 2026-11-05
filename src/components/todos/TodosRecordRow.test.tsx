/**
 * Timing — 计时行回归测试（V0.3.13）
 * -----------------------------------------------------------------------------
 * 用户口径：「点开编辑事项…点击一个事项名，随后可以删除、写下其他名字，
 * 点击某一事项的开始时间，输入新的时间即可」——所以：
 *   - 只读：名字 / 起止区间 / 时长，行尾无动作；
 *   - 编辑：名字就地变输入框（Enter 提交改名），开始 / 结束各一枚可打字的定宽位，
 *     行尾删除 → 内联确认条（记录挂的是事项，保留二次确认）；
 *   - 进行中的行没有可改的边界记录，编辑态也不出时间位。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { TodosRecordRow } from './TodosRecordRow';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime();
const T0 = new Date(2026, 9, 20, 8, 0, 0, 0).getTime();
const HOUR = 3_600_000;

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

async function typeInto(input: HTMLInputElement, text: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  await act(async () => {
    setter?.call(input, text);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

interface Handlers {
  onCommitTime: Mock<(recordId: number, field: 'start' | 'end', ms: number) => void>;
  onTimeError: Mock<(message: string) => void>;
  onRequestDelete: Mock<() => void>;
  onSubmitRename: Mock<(name: string) => void>;
  onActivate: Mock<() => void>;
}

function renderRow(editMode: boolean, over: Partial<Handlers> = {}, running = false) {
  const h = {
    onCommitTime: vi.fn<(recordId: number, field: 'start' | 'end', ms: number) => void>(),
    onTimeError: vi.fn<(message: string) => void>(),
    onRequestDelete: vi.fn<() => void>(),
    onSubmitRename: vi.fn<(name: string) => void>(),
    onActivate: vi.fn<() => void>(),
    ...over,
  };
  return {
    handlers: h,
    ui: createElement(TodosRecordRow, {
      name: '写周报',
      startedAt: T0,
      endedAt: running ? null : T0 + HOUR,
      seconds: 3600,
      status: running ? ('running' as const) : ('done' as const),
      mode: 'view' as const,
      editMode,
      now: NOW,
      startRecordId: running ? undefined : 11,
      endRecordId: running ? undefined : 12,
      onCommitTime: h.onCommitTime,
      onTimeError: h.onTimeError,
      onContextMenu: vi.fn(),
      onRequestDelete: h.onRequestDelete,
      onSubmitRename: h.onSubmitRename,
      onCancelEdit: vi.fn(),
      onConfirmDelete: vi.fn(),
      onActivate: h.onActivate,
    }),
  };
}

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('只读态', () => {
  it('显示区间与时长，行尾没有动作', async () => {
    const { ui } = renderRow(false);
    const el = await mount(ui);
    expect(el.querySelector('.todo-row__time')?.textContent).toContain('–');
    expect(el.querySelector('.todo-row__act')).toBeNull();
    expect(el.querySelector('.todo-row__chip')).toBeNull();
  });
});

describe('编辑态：点哪改哪，直接打字', () => {
  it('点名字 → 输入框 → Enter 提交改名', async () => {
    const { ui, handlers } = renderRow(true);
    const el = await mount(ui);

    await click(el.querySelector('.todo-row__name--btn'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text');
    expect(input?.value).toBe('写周报');

    await typeInto(input!, '写月报');
    await press(input!, 'Enter');
    expect(handlers.onSubmitRename).toHaveBeenCalledWith('写月报');
  });

  it('点删除 → 请求确认（不即时删）', async () => {
    const { ui, handlers } = renderRow(true);
    const el = await mount(ui);
    await click(el.querySelector('.todo-row__act'));
    expect(handlers.onRequestDelete).toHaveBeenCalledTimes(1);
  });

  it('开始 / 结束各一枚可打字的时间位，提交到对应记录', async () => {
    const { ui, handlers } = renderRow(true);
    const el = await mount(ui);

    const startChip = el.querySelector<HTMLButtonElement>('.todo-row__chip[data-field="start"]');
    const endChip = el.querySelector<HTMLButtonElement>('.todo-row__chip[data-field="end"]');
    expect(startChip).not.toBeNull();
    expect(endChip).not.toBeNull();
    expect(el.querySelector('.todo-row__time')).toBeNull();

    await click(startChip);
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;
    await typeInto(input, '07:30');
    await press(input, 'Enter');
    expect(handlers.onCommitTime).toHaveBeenCalledTimes(1);
    const [recordId, field, ms] = handlers.onCommitTime.mock.calls[0];
    expect(recordId).toBe(11);
    expect(field).toBe('start');
    expect(new Date(ms).getHours()).toBe(7);
  });

  it('结束早于开始 → 不提交，提示', async () => {
    const { ui, handlers } = renderRow(true);
    const el = await mount(ui);
    await click(el.querySelector('.todo-row__chip[data-field="end"]'));
    const input = el.querySelector<HTMLInputElement>('input.inline-text')!;

    await typeInto(input, '07:00'); // 早于 startedAt(08:00)
    await press(input, 'Enter');
    expect(handlers.onCommitTime).not.toHaveBeenCalled();
    expect(handlers.onTimeError).toHaveBeenCalled();
  });

  it('进行中的行没有可改的边界，编辑态也不出时间位', async () => {
    const { ui } = renderRow(true, {}, true);
    const el = await mount(ui);
    expect(el.querySelector('.todo-row__chip')).toBeNull();
    expect(el.querySelector('.todo-row__time')).not.toBeNull();
  });
});

/* [V0.4.2] 用户口径：「在事项菜单点击事项可以直接开始计时」 */
describe('点行 = 开始这一条事项的计时', () => {
  it('只读态点整行 → 触发 onActivate', async () => {
    const { ui, handlers } = renderRow(false);
    const el = await mount(ui);
    await click(el.querySelector('.todo-row'));
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
  });

  it('键盘 Enter 等价于点这一行', async () => {
    const { ui, handlers } = renderRow(false);
    const el = await mount(ui);
    await press(el.querySelector('.todo-row')!, 'Enter');
    expect(handlers.onActivate).toHaveBeenCalledTimes(1);
  });

  it('编辑态点行不触发（那里的点击是改名 / 输时间）', async () => {
    const { ui, handlers } = renderRow(true);
    const el = await mount(ui);
    await click(el.querySelector('.todo-row__chip'));
    await click(el.querySelector('.todo-row'));
    expect(handlers.onActivate).not.toHaveBeenCalled();
    expect(el.querySelector('.todo-row')?.getAttribute('data-clickable')).toBe('false');
  });
});
