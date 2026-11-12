/**
 * Timing — 「待办直接开始计时」的边界探针（QA 独立补测，v0.5.0）
 * -----------------------------------------------------------------------------
 * 与工程师自带的三个测试**不重复**：那三个钉的是主路径（idle 直开 / 非 idle 弹选单 /
 * 切换失败不删待办）。这里钉的是主路径之外的六个边界，它们每一个都能在真机上被用户触发：
 *
 *   1. 暂停态点开始 → 绝不能「再暂停一次」（`pause` 已幂等，但仍要断言没多打一次命令）
 *   2. `pause` 成功、`switchItem` 失败 → 秒表被留在暂停（**已知问题 P2**，见验证报告）
 *   3. 选单打开期间计时被结束 → 确认必须安全回落到空闲路径（不许报 TIMER_ALREADY_RUNNING）
 *   4. 切换失败 → 面板关掉、待办留着、提示弹出（UI 层的三条一起看）
 *   5. 建事项成功、切换失败 → 事项已成孤儿（**已知问题 P2**，此处只钉「没有回滚」这一事实）
 *   6. 两条同名待办 + 当前事项同名 → 两行都亮「计时中」（**已知问题 P2**，标题匹配的固有代价）
 *
 * R2 起，原第 7 条（连点）迁到 `TodoStartEdges.r2.test.tsx`——它在 R2 拆成「闸生效 / 闸被
 * 闭包快照绕过」两条，混在本文件里会互相矛盾。归档匹配（P1-1）也在那边。
 *
 * ⚠️ 「已知问题」的断言写的是**当前实际行为**，作用是防回归——修好之后这些用例必须一起改，
 * 改动点就是这六处。分级与建议见 `docs/mobile/VERIFY-TODO-TIMER-v0.5.0.md`。
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
import { TodoSwitchSheet } from './SwitchModeSheet';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const NOW = 1_764_000_000_000;

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
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

function makeItem(over: Partial<Item> = {}): Item {
  return {
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
    ...over,
  };
}

function makeRecord(over: Partial<TimeRecord> = {}): TimeRecord {
  return {
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
    ...over,
  };
}

const IDLE: TimerState = { status: 'idle', session: null, lastItemId: 2, liveDurationSec: 0, mode: 'countup', remainingSec: null };
const PAUSED: TimerState = { ...IDLE, status: 'paused', session: makeRecord({ itemId: 2, runningSince: null }) };
const RUNNING: TimerState = { ...IDLE, status: 'running', session: makeRecord({ itemId: 2 }) };

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

async function click(el: Element | null | undefined): Promise<void> {
  if (!el) throw new Error('要点的元素不存在');
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

function byText(el: HTMLElement, text: string): HTMLButtonElement | null {
  return Array.from(el.querySelectorAll('button')).find((b) => b.textContent?.trim() === text) ?? null;
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  useTodoStore.setState({ todos: [makeTodo()], loaded: true, error: null, pendingDelete: null });
  useItemStore.setState({ items: [makeItem()], loaded: true });
  useTimerStore.setState({ state: IDLE, loaded: true });
  useMobileUiStore.setState({ tab: 'items', sheet: null });
  useUiStore.getState().setNotice(null);

  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(itemApi.list).mockImplementation(async () => useItemStore.getState().items);
  vi.mocked(todoApi.start).mockResolvedValue(makeRecord({ itemId: 7 }));
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
  vi.mocked(itemApi.create).mockResolvedValue(makeItem({ id: 9 }));
  vi.mocked(timerApi.switchItem).mockResolvedValue({ ...RUNNING, session: makeRecord({ itemId: 7 }) });
  vi.mocked(timerApi.pause).mockResolvedValue(makeRecord({ runningSince: null }));
  vi.mocked(timerApi.resume).mockResolvedValue(makeRecord({ itemId: 7 }));
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('① 暂停态点开始：不许再暂停一次', () => {
  it('paused + end_and_start → 一条 pause 都不发，直接 switchItem', async () => {
    useTimerStore.setState({ state: PAUSED, loaded: true });

    const ok = await mobileTimerActions.startTodo(makeTodo(), 'end_and_start');

    expect(ok).toBe(true);
    expect(timerApi.pause).not.toHaveBeenCalled();
    expect(timerApi.switchItem).toHaveBeenCalledWith(7, 'end_and_start');
    expect(todoApi.remove).toHaveBeenCalledWith(3);
  });

  it('paused + just_switch → pause / resume 都不发（用户本来就是暂停的，别替他继续）', async () => {
    useTimerStore.setState({ state: PAUSED, loaded: true });

    await mobileTimerActions.startTodo(makeTodo(), 'just_switch');

    expect(timerApi.pause).not.toHaveBeenCalled();
    expect(timerApi.resume).not.toHaveBeenCalled();
  });
});

describe('② 已知问题 P2：pause 成功但 switchItem 失败 → 秒表被留在暂停', () => {
  it('running + end_and_start，switchItem 抛错 → 有 pause、无 resume（无补偿）', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    vi.mocked(timerApi.switchItem).mockRejectedValue(new Error('切不过去'));

    const ok = await mobileTimerActions.startTodo(makeTodo(), 'end_and_start');

    expect(ok).toBe(false);
    /* 待办保住（硬约束满足） */
    expect(todoApi.remove).not.toHaveBeenCalled();
    /* 但冻结累计已经发生，失败后没人把它恢复：用户看到秒表停了却只收到「切不过去」 */
    expect(timerApi.pause).toHaveBeenCalledTimes(1);
    expect(timerApi.resume).not.toHaveBeenCalled();
  });
});

describe('③ 选单打开期间计时被结束 → 确认安全回落', () => {
  it('面板开着，计时已经 idle；点「就这样切」走 todo_start，不碰 switchItem', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    const el = await mount(createElement(TodoSwitchSheet, { todoId: 3, title: '写周报' }));

    /* 面板打开之后计时被结束（例如计时页点了停止） */
    useTimerStore.setState({ state: IDLE, loaded: true });
    await click(byText(el, '就这样切'));

    expect(todoApi.start).toHaveBeenCalledWith(3);
    expect(timerApi.switchItem).not.toHaveBeenCalled();
    expect(timerApi.pause).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice).toBeNull();
  });
});

describe('④ 切换失败：面板关掉、待办留着、提示弹出', () => {
  it('UI 层三条一起看（action 层的顺序已由工程师单测覆盖）', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    vi.mocked(timerApi.switchItem).mockRejectedValue(new Error('切不过去'));
    const el = await mount(createElement(TodoSwitchSheet, { todoId: 3, title: '写周报' }));

    await click(byText(el, '就这样切'));

    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice?.text).toBe('切不过去');
    /* 现状：失败也关面板（用户要重新点一次待办才能重试） */
    expect(useMobileUiStore.getState().sheet).toBeNull();
  });
});

describe('⑤ 已知问题 P2：建了事项但切换失败 → 孤儿事项', () => {
  it('itemApi.create 已经落地，失败后没有任何 delete 补偿', async () => {
    useTimerStore.setState({ state: RUNNING, loaded: true });
    /* 全库（含归档）真的没有同名事项 → 才允许走「新建」这条路。
       注意 R2 起匹配源是 `list({includeArchived:true})`，不再是 `useItemStore.items`。 */
    useItemStore.setState({ items: [makeItem({ id: 2, name: '别的事' })], loaded: true });
    vi.mocked(timerApi.switchItem).mockRejectedValue(new Error('切不过去'));

    const ok = await mobileTimerActions.startTodo(makeTodo(), 'end_and_start');

    expect(ok).toBe(false);
    expect(itemApi.create).toHaveBeenCalledWith({ name: '写周报' });
    /* 事项列表里从此多一条没人用的「写周报」，且没有任何回滚调用存在 */
    expect(todoApi.remove).not.toHaveBeenCalled();
  });
});

describe('⑥ 已知问题 P2：两条同名待办 → 两行都亮「计时中」', () => {
  it('active 判定是标题匹配，同名行无法区分谁被消费了', async () => {
    useTodoStore.setState({
      todos: [makeTodo({ id: 3 }), makeTodo({ id: 4, sortOrder: 2 })],
      loaded: true,
      error: null,
      pendingDelete: null,
    });
    /* 当前计时事项就是「写周报」（id 7）：两条同名待办都该命中标题匹配 */
    useTimerStore.setState({ state: { ...RUNNING, session: makeRecord({ itemId: 7 }) }, loaded: true });

    const el = await mount();

    expect(el.querySelectorAll('.m-todo__live')).toHaveLength(2);
    expect(el.querySelectorAll('button.m-btn--accent')).toHaveLength(0);
  });
});

/* ⑦（空闲连点）与 ⑧（归档同名）已迁到 `TodoStartEdges.r2.test.tsx`：
   R2 里这两处的行为变了，「闸是闭包快照」「归档必须复用」需要分开钉，留在这里会混。
   本文件其余 6 条在 R2 后**语义未变**（P2-2 / P2-3 / P2-4 / 失败保留待办）。 */
