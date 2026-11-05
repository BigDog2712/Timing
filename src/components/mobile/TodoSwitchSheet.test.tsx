/**
 * TickBar — 计时中点待办的确认面板
 * -----------------------------------------------------------------------------
 * 用户已拍板：已经在计时时点另一条待办，要弹选单让人选「结束并新开 / 仅改归属」。
 * 这里钉住面板的两个出口：
 *   - 「仅改归属」+ 存在同名事项 → 直接切到那条事项（不开新事项），切完才删待办；
 *   - 取消 → 一条命令都不发，待办与记录都原样不动。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, TimeRecord, TimerState, Todo } from '../../types/domain';

vi.mock('../../services/api', () => ({
  itemApi: { list: vi.fn(async () => []), create: vi.fn(async () => ({ id: 9, name: '' })) },
  todoApi: {
    list: vi.fn(async () => []),
    create: vi.fn(),
    update: vi.fn(),
    toggle: vi.fn(),
    start: vi.fn(async () => ({ id: 1 })),
    remove: vi.fn(async () => undefined),
  },
  timerApi: {
    state: vi.fn(),
    start: vi.fn(async () => ({})),
    pause: vi.fn(async () => ({})),
    resume: vi.fn(async () => ({})),
    switchItem: vi.fn(async () => ({})),
  },
  recordApi: { list: vi.fn(), summary: vi.fn(), update: vi.fn(), remove: vi.fn() },
  noteApi: { get: vi.fn(), list: vi.fn(), create: vi.fn(), update: vi.fn(), remove: vi.fn() },
  settingsApi: { get: vi.fn(), update: vi.fn(), getReference: vi.fn(), updateReference: vi.fn() },
  reminderApi: { pending: vi.fn(), set: vi.fn(), clear: vi.fn() },
  windowApi: {},
  pluginApi: {},
  mdSyncApi: {},
  isTauri: () => false,
  errorText: (err: unknown) => (err instanceof Error ? err.message : String(err)),
}));

import { itemApi, timerApi, todoApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { useUiStore } from '../../stores/uiStore';
import { TodoSwitchSheet } from './SwitchModeSheet';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_764_000_000_000;

const TODO: Todo = {
  id: 3,
  title: '写周报',
  plannedAt: null,
  remindAt: null,
  remindedAt: null,
  doneAt: null,
  sortOrder: 1,
  createdAt: NOW,
  updatedAt: NOW,
};

const ITEM: Item = {
  id: 7,
  name: '写周报',
  color: null,
  status: 'active',
  isSystem: false,
  sortOrder: 1,
  remindAt: null,
  remindedAt: null,
  isPinned: false,
  createdAt: NOW,
  updatedAt: NOW,
};

const RECORD: TimeRecord = {
  id: 11,
  itemId: 2,
  status: 'active',
  startedAt: NOW,
  endedAt: null,
  accumulatedSec: 60,
  runningSince: NOW,
  note: null,
  mode: 'countup',
  targetSec: null,
};

const RUNNING: TimerState = {
  status: 'running',
  session: RECORD,
  lastItemId: 2,
  liveDurationSec: 60,
  mode: 'countup',
  remainingSec: null,
};

let container: HTMLDivElement;
let root: Root;

async function mount(): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(TodoSwitchSheet, { todoId: TODO.id, title: TODO.title }));
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

/** 按文案找按钮（分段与页脚都用文字定位，避免靠 class 顺序猜） */
function byText(el: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  useTodoStore.setState({ todos: [TODO], loaded: true, error: null, pendingDelete: null });
  useItemStore.setState({ items: [ITEM], loaded: true });
  useTimerStore.setState({ state: RUNNING, loaded: true });
  useMobileUiStore.setState({ sheet: { kind: 'todoSwitch', todoId: TODO.id, title: TODO.title } });
  useUiStore.getState().setNotice(null);

  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(itemApi.list).mockImplementation(async () => useItemStore.getState().items);
  vi.mocked(timerApi.switchItem).mockResolvedValue({ ...RUNNING, session: { ...RECORD, itemId: ITEM.id } });
  vi.mocked(timerApi.pause).mockResolvedValue({ ...RECORD, runningSince: null });
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('确认面板', () => {
  it('默认「结束并新开」，两种方式的说明都能看到（不把枚举名抛给用户）', async () => {
    const el = await mount();

    expect(byText(el, '结束并新开')?.getAttribute('aria-checked')).toBe('true');
    expect(byText(el, '仅改归属')?.getAttribute('aria-checked')).toBe('false');
    expect(el.textContent).toContain('这段记入记录，新事项从 0 开始');
    expect(el.textContent).not.toContain('end_and_start');
    expect(el.textContent).not.toContain('just_switch');
  });

  it('选「仅改归属」→ 同名事项直接复用，切完再删待办，面板关闭', async () => {
    const el = await mount();
    await click(byText(el, '仅改归属'));
    await click(byText(el, '就这样切'));

    expect(timerApi.switchItem).toHaveBeenCalledWith(ITEM.id, 'just_switch');
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(todoApi.remove).toHaveBeenCalledWith(TODO.id);
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });

  it('取消 → 一条命令都不发（待办与记录原样不动）', async () => {
    const el = await mount();
    await click(byText(el, '取消'));

    expect(timerApi.switchItem).not.toHaveBeenCalled();
    expect(timerApi.pause).not.toHaveBeenCalled();
    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });
});
