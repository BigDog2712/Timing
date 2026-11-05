/**
 * Timing — 「待办直接开始计时」第 2 轮回归探针（QA，v0.5.0 · R2）
 * -----------------------------------------------------------------------------
 * 与 `TodoStartEdges.test.tsx`（R1）分工：那边钉 R1 的边界，这里钉 **R2 的 4 项修复**
 * 以及修复过程中暴露出来、工程师单测没覆盖的两处：
 *
 *   ① 连点锁在「两次 click 落在同一个同步块内」时是否真的挡住（React 闭包快照陷阱）
 *   ② 连点锁是否误伤了「非 idle → 弹选单」这条完全不同的路径
 *
 * ⚠️ **② 不在这里守**：P2-13（锁上时点另一条仍须弹选单）是 `ItemsPage` 的行为，
 * 按「守护对象归属」交给 `ItemsPage.guard.test.tsx` 的「不外溢（P2-13）」那一组；
 * 这里删掉了重复覆盖，避免将来改实现要改两处。找不到别以为漏了。
 *
 * 这两条都曾是「钉住已知问题」的用例（当时断言 `useState` 版会放行 2 次）；
 * 源码改成 `startingRef`（`useRef`）并把锁挪进 idle 分支后，断言已翻转为**钉住正确行为**，
 * 现在 ① 是真正的回归保护：谁把锁退回 `useState`，这里立刻变红（工程师那份守的是「锁接线了没有」，
 * 这份守的是「锁够不够硬」，两者不重复）。
 * 对照实验与分级见 `docs/mobile/VERIFY-TODO-TIMER-v0.5.0.md` §R2-4。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
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
  useTodayRecords: () => ({ loading: false, error: null, totalSec: 0, recordCount: 0, rows: [], reload: () => undefined }),
}));
vi.mock('../../hooks/useTimerTick', () => ({ useTimerTick: () => 0 }));

import { itemApi, timerApi, todoApi } from '../../services/api';
import { mobileTimerActions } from '../../services/mobileTimerActions';
import { useItemStore } from '../../stores/itemStore';
import { useMobileUiStore } from '../../stores/mobileUiStore';
import { useTimerStore } from '../../stores/timerStore';
import { useTodoStore } from '../../stores/todoStore';
import { useUiStore } from '../../stores/uiStore';
import { ItemsPage } from './ItemsPage';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_764_000_000_000;

const TODO: Todo = { id: 3, title: '写周报', plannedAt: null, remindAt: null, remindedAt: null, doneAt: null, sortOrder: 1, createdAt: NOW, updatedAt: NOW };

function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 7, name: '写周报', color: null, status: 'active', isSystem: false, sortOrder: 1,
    remindAt: null, remindedAt: null, isPinned: false, createdAt: NOW, updatedAt: NOW, ...over,
  };
}

const REC: TimeRecord = { id: 11, itemId: 2, status: 'active', startedAt: NOW, endedAt: null, accumulatedSec: 60, runningSince: NOW, note: null, mode: 'countup', targetSec: null };
const IDLE: TimerState = { status: 'idle', session: null, lastItemId: 2, liveDurationSec: 0, mode: 'countup', remainingSec: null };
const RUNNING: TimerState = { ...IDLE, status: 'running', session: REC };
const PAUSED: TimerState = { ...IDLE, status: 'paused', session: { ...REC, runningSince: null } };

let container: HTMLDivElement;
let root: Root;

async function mount(ui: ReactElement = createElement(ItemsPage)): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

function fire(el: Element | null | undefined): void {
  el?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
}

const startBtn = (el: HTMLElement) => el.querySelector<HTMLButtonElement>('button.m-btn--accent');

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  useTodoStore.setState({ todos: [TODO], loaded: true, error: null, pendingDelete: null });
  useItemStore.setState({ items: [makeItem()], loaded: true });
  useTimerStore.setState({ state: IDLE, loaded: true });
  useMobileUiStore.setState({ tab: 'items', sheet: null });
  useUiStore.getState().setNotice(null);

  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(itemApi.list).mockImplementation(async () => useItemStore.getState().items);
  vi.mocked(todoApi.start).mockResolvedValue(REC);
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
  vi.mocked(timerApi.switchItem).mockResolvedValue({ ...RUNNING, session: { ...REC, itemId: 7 } });
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('① P2-1 / P2-12 连点锁：useRef 同步写入，同一 commit 内也挡得住', () => {
  /** 挂着不放：把锁钉在 true，模拟命令往返期间的第二下 */
  const hang = () => new Promise<TimeRecord>(() => undefined);

  it('两次 click 分处两个 commit（真实用户手势的时序）→ 只发一条', async () => {
    vi.mocked(todoApi.start).mockImplementation(hang);
    const el = await mount();

    await act(async () => fire(startBtn(el)));
    await act(async () => fire(startBtn(el)));

    expect(todoApi.start).toHaveBeenCalledTimes(1);
  });

  it('两次 click 落在同一个同步块（中间无 re-render）→ 仍然只发一条', async () => {
    vi.mocked(todoApi.start).mockImplementation(hang);
    const el = await mount();

    await act(async () => {
      fire(startBtn(el));
      fire(startBtn(el));
    });

    /* 这条是本轮的关键回归保护：`startingRef.current = true` 在 await 之前**同步**写入，
       与 render 快照无关，所以同一同步块内连发也被挡住。
       ⚠️ 若有人把锁退回 `useState`（读闭包快照），这条会立刻变红——这正是它的用处。
       实测：useState 版此处为 2 次；useRef 版为 1 次（对照实验见报告 §R2-4）。 */
    expect(todoApi.start).toHaveBeenCalledTimes(1);
  });
});

/* ②（P2-13：锁上时点另一条仍须弹选单）已按主理人裁决删掉——它归 `ItemsPage` 的测试族守，
   现由 `ItemsPage.guard.test.tsx` 的「不外溢（P2-13）」覆盖。这里不是漏了，见文件头指针。 */

describe('③ P1-1 归档匹配口径（修复后）', () => {
  it('同名事项已归档 → 复用归档事项的 id，不新建；且必须带 includeArchived', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    /* 选择器列表里没有它（归档不进选择器），但 list({includeArchived}) 能看到 */
    useItemStore.setState({ items: [makeItem({ id: 2, name: '别的事' })], loaded: true });
    vi.mocked(itemApi.list).mockResolvedValue([makeItem({ id: 5, name: '写周报', status: 'archived' })]);

    const ok = await mobileTimerActions.startTodo(TODO, 'end_and_start');

    expect(ok).toBe(true);
    expect(itemApi.list).toHaveBeenCalledWith({ includeArchived: true });
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(timerApi.switchItem).toHaveBeenCalledWith(5, 'end_and_start');
    /* 归档列表只用于匹配，不写回选择器 store */
    expect(useItemStore.getState().items.map((i) => i.id)).toEqual([2]);
    /* 切换成功才删待办 */
    expect(todoApi.remove).toHaveBeenCalledWith(3);
  });

  it('同名多条（一归档一活跃、id 交错）→ 取最小 id，且不打乱 list 返回的数组', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    const unsorted = [makeItem({ id: 9, name: '写周报', isPinned: true }), makeItem({ id: 4, name: '写周报', status: 'archived' })];
    vi.mocked(itemApi.list).mockResolvedValue(unsorted);

    await mobileTimerActions.startTodo(TODO, 'end_and_start');

    /* 后端 ORDER BY id ASC LIMIT 1 → 4；`.filter().sort()[0]` 等价 */
    expect(timerApi.switchItem).toHaveBeenCalledWith(4, 'end_and_start');
    /* sort 是原地排序，但作用在 filter 的副本上：源数组顺序不许被动 */
    expect(unsorted.map((i) => i.id)).toEqual([9, 4]);
  });

  it('读不到事项列表 → 报错收手：不新建、不删待办', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    vi.mocked(itemApi.list).mockRejectedValue(new Error('读事项失败'));

    const ok = await mobileTimerActions.startTodo(TODO, 'end_and_start');

    expect(ok).toBe(false);
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice?.text).toBe('读事项失败');
  });
});

describe('④ P2-5 已暂停文案（页层接线）', () => {
  it('暂停态 + 两条同名：都写「已暂停」、都是 live region、都没有可点的开始', async () => {
    useTodoStore.setState({ todos: [TODO, { ...TODO, id: 4, sortOrder: 2 }], loaded: true, error: null, pendingDelete: null });
    useTimerStore.setState({ state: { ...PAUSED, session: { ...REC, itemId: 7, runningSince: null } }, loaded: true });

    const el = await mount();
    const live = el.querySelectorAll('.m-todo__live');

    expect(Array.from(live).map((n) => n.textContent)).toEqual(['已暂停', '已暂停']);
    expect(live[0]?.getAttribute('role')).toBe('status');
    expect(el.querySelectorAll('button.m-btn--accent')).toHaveLength(0);
  });
});
