/**
 * TickBar — 事项页「待办点开始」的接线回归
 * -----------------------------------------------------------------------------
 * 用户诉求原话：「事项是绑定计时的，待办事项应可以直接开始计时」。
 * 所以这里的判据是**点击那一刻的计时状态**决定走哪条路：
 *   - 空闲 → 直接开计（`todo_start`，一条命令搞定匹配 / 新建 / 删待办）；
 *   - 已经在计时 → 弹「结束并新开 / 仅改归属」选单，**用户没确认之前不许动数据**。
 *
 * 不 mock `mobileTimerActions`：走真实动作层，才能证明「点了开始 → 真的开计时」这条链路通。
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

/* 今日记录区与本页修复无关，直接给一份空数据，避免它去拉真实 ipc */
vi.mock('../../hooks/useTodayRecords', () => ({
  useTodayRecords: () => ({
    loading: false,
    error: null,
    totalSec: 0,
    recordCount: 0,
    rows: [],
    reload: () => undefined,
  }),
}));
vi.mock('../../hooks/useTimerTick', () => ({ useTimerTick: () => 0 }));

import { timerApi, todoApi } from '../../services/api';
import { useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { ItemsPage } from './ItemsPage';

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

const IDLE: TimerState = {
  status: 'idle',
  session: null,
  lastItemId: 2,
  liveDurationSec: 0,
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
    root.render(createElement(ItemsPage));
  });
  return container;
}

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  useTodoStore.setState({ todos: [TODO], loaded: true, error: null, pendingDelete: null });
  useItemStore.setState({ items: [ITEM], loaded: true });
  useTimerStore.setState({ state: IDLE, loaded: true });
  useMobileUiStore.setState({ tab: 'items', sheet: null });

  /* `refresh()` 回读 store 当前快照：本测试只关心「点了之后发了哪些命令」 */
  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(todoApi.start).mockResolvedValue(RECORD);
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('空闲时点「开始」', () => {
  it('走 todo_start（后端一条命令完成匹配 / 开计 / 删待办），不弹选单', async () => {
    const el = await mount();
    await click(el.querySelector('button.m-btn--accent'));

    expect(todoApi.start).toHaveBeenCalledWith(TODO.id);
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });
});

describe('已经在计时时点「开始」', () => {
  it('弹出「结束并新开 / 仅改归属」选单，且用户确认前一条命令都不发', async () => {
    useTimerStore.setState({ state: { ...IDLE, status: 'running', session: RECORD }, loaded: true });
    const el = await mount();
    await click(el.querySelector('button.m-btn--accent'));

    expect(useMobileUiStore.getState().sheet).toEqual({
      kind: 'todoSwitch',
      todoId: TODO.id,
      title: TODO.title,
    });
    /* 关键：没确认之前不许开计时、也不许删待办 */
    expect(todoApi.start).not.toHaveBeenCalled();
    expect(todoApi.remove).not.toHaveBeenCalled();
  });

  it('暂停态同样走选单（暂停不是「空闲」）', async () => {
    useTimerStore.setState({
      state: { ...IDLE, status: 'paused', session: { ...RECORD, runningSince: null } },
      loaded: true,
    });
    const el = await mount();
    await click(el.querySelector('button.m-btn--accent'));

    expect(useMobileUiStore.getState().sheet?.kind).toBe('todoSwitch');
    expect(todoApi.start).not.toHaveBeenCalled();
  });
});

describe('暂停态（P2-5）', () => {
  it('会话暂停时标记写「已暂停」，不是「计时中」', async () => {
    useTimerStore.setState({
      state: { ...IDLE, status: 'paused', session: { ...RECORD, itemId: ITEM.id, runningSince: null } },
      loaded: true,
    });
    const el = await mount();

    expect(el.querySelector('.m-todo__live')?.textContent).toBe('已暂停');
    expect(el.querySelector('button.m-btn--accent')).toBeNull();
  });
});

describe('这条待办对应的事项正在计时', () => {
  it('不再给可点的「开始」，只显示静态「计时中」', async () => {
    useTimerStore.setState({ state: { ...IDLE, status: 'running', session: { ...RECORD, itemId: ITEM.id } }, loaded: true });
    const el = await mount();

    expect(el.querySelector('button.m-btn--accent')).toBeNull();
    expect(el.querySelector('.m-todo__live')?.textContent).toBe('计时中');
  });
});

describe('已完成区', () => {
  it('已完成待办不渲染「开始」（点了必报 TODO_NOT_FOUND）', async () => {
    useTodoStore.setState({
      /* `todoPanelLists` 只把「今天完成的」放进已完成区，所以用当前时刻 */
      todos: [{ ...TODO, id: 5, title: '刚写完的周报', doneAt: Date.now() }],
      loaded: true,
      error: null,
      pendingDelete: null,
    });
    const el = await mount();

    /* 待办区为空，先把「已完成 N 条」展开 */
    await click(el.querySelector('button.m-more'));

    expect(el.textContent).toContain('刚写完的周报');
    expect(el.querySelector('button.m-btn--accent'), '已完成待办不该有开始按钮').toBeNull();
  });
});
