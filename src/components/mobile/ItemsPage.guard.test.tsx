/**
 * Timing — 事项页「开始」的防连发 / 防误伤（P2-1、P2-12、P2-13）
 * -----------------------------------------------------------------------------
 * 为什么单独一个文件：这两条钉的都是**闸本身**的行为（能不能拦住第二下、
 * 会不会连不该拦的也拦住），与 `ItemsPage.todoStart.test.tsx` 里「点开始走哪条路」
 * 的接线回归不是一回事；放一起会把那个文件顶过 300 行。
 * （vitest 的 `vi.mock` 工厂是 hoisted 的，不能跨文件共享，所以这里自带一份同构的 api mock。）
 *
 * 两条判据：
 *   1. 锁得住：`todo_start` 还没回来时，对**同一条/任意一条**再点也不会发第二条命令；
 *   2. 不外溢：锁只在 idle 分支内。非 idle 点待办要弹选单（同步动作、零命令），
 *      不该被「另一条正在开计时」挡住——否则界面零反馈，就是用户抱怨的「点了没反应」。
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

function makeTodo(over: Partial<Todo> = {}): Todo {
  return {
    id: 3,
    title: '写周报',
    plannedAt: null,
    remindAt: null,
    remindedAt: null,
    doneAt: null,
    sortOrder: 1,
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

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

const TODO_A = makeTodo({ id: 3, title: '写周报' });
const TODO_B = makeTodo({ id: 4, title: '买牛奶' });

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

/** 某条待办行上的「开始」按钮（按标题定位，避免依赖行序） */
function startBtnOf(el: HTMLElement, title: string): HTMLButtonElement {
  const row = Array.from(el.querySelectorAll('li.m-todo')).find((li) => li.textContent?.includes(title));
  const btn = row?.querySelector<HTMLButtonElement>('button.m-btn--accent') ?? null;
  if (!btn) throw new Error(`「${title}」那一行没有开始按钮`);
  return btn;
}

/** 让 `todo_start` 挂住不回包：把锁钉在「已上锁」状态，直到手动 release */
function hangStart(): { release: () => void } {
  let release: (record: TimeRecord) => void = () => undefined;
  vi.mocked(todoApi.start).mockImplementation(
    () =>
      new Promise<TimeRecord>((resolve) => {
        release = resolve;
      }),
  );
  return { release: () => release({ ...RECORD, itemId: ITEM.id }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  useTodoStore.setState({ todos: [TODO_A, TODO_B], loaded: true, error: null, pendingDelete: null });
  useItemStore.setState({ items: [ITEM], loaded: true });
  useTimerStore.setState({ state: IDLE, loaded: true });
  useMobileUiStore.setState({ tab: 'items', sheet: null });

  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('锁得住（P2-1 / P2-12）', () => {
  it('同一同步块里连点两次 → 只发一条 todo_start（useRef 同步写入，不靠闭包快照）', async () => {
    const { release } = hangStart();
    const el = await mount();
    const btn = startBtnOf(el, TODO_A.title);

    /* 关键：两次 click 之间**没有** re-render（同一个 commit），
       `useState` 版本会读到旧的 false 快照而放行第二条；`useRef` 不会。 */
    await act(async () => {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });

    expect(todoApi.start).toHaveBeenCalledTimes(1);
    await act(async () => release());
    expect(todoApi.start).toHaveBeenCalledTimes(1);
  });

  it('命令回包后锁会释放（不是一次性死锁）', async () => {
    const { release } = hangStart();
    const el = await mount();
    const btn = startBtnOf(el, TODO_A.title);

    await click(btn);
    await act(async () => release());

    /* 回到 idle（例如这次开始被撤销 / 计时被结束），再点必须还能发命令 */
    await act(async () => {
      useTimerStore.setState({ state: IDLE, loaded: true });
    });
    await click(btn);

    expect(todoApi.start).toHaveBeenCalledTimes(2);
  });
});

describe('不外溢（P2-13）', () => {
  it('A 正在开计时（锁上）时点 B：非 idle → 必须弹出选单，不能静默吞掉', async () => {
    const { release } = hangStart();
    const el = await mount();

    /* 第一下：A 开始计时，命令挂住 → 锁仍上着 */
    await click(startBtnOf(el, TODO_A.title));

    /* 真实时序：状态在命令回包前由事件置为 running */
    await act(async () => {
      useTimerStore.setState({
        state: { ...IDLE, status: 'running', session: { ...RECORD, itemId: ITEM.id } },
        loaded: true,
      });
    });

    /* 第二下：点 B。闸若挂在 startTodo 首行，这一下会被吞掉（sheet=null、notice=null） */
    await click(startBtnOf(el, TODO_B.title));

    expect(useMobileUiStore.getState().sheet).toEqual({
      kind: 'todoSwitch',
      todoId: TODO_B.id,
      title: TODO_B.title,
    });

    await act(async () => release());
  });
});
