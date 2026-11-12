/**
 * Timing — 移动端「待办 → 计时」的时序单测（本轮修复点）
 * -----------------------------------------------------------------------------
 * 钉住三件事，它们都是真机上用户能直接感知的行为：
 *   1. 空闲点「开始」→ 只调 `todo_start`（匹配事项 / 新建 / 删待办全在后端，前端不重复）；
 *   2. 计时中点「开始」→ 先换事项，**成功之后**才软删待办（顺序反了就是「待办没了、时间也没记到」）；
 *   3. 换事项失败 → 待办必须原样留着，让人可以重试。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, TimeRecord, TimerState, Todo } from '../types/domain';

vi.mock('./api', () => ({
  itemApi: {
    list: vi.fn(async () => []),
    create: vi.fn(async () => ({ id: 0, name: '' })),
  },
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

import { itemApi, timerApi, todoApi } from './api';
import { mobileTimerActions } from './mobileTimerActions';
import { useItemStore } from '../stores/itemStore';
import { useTimerStore } from '../stores/timerStore';
import { useTodoStore } from '../stores/todoStore';
import { useUiStore } from '../stores/uiStore';

const NOW = 1_764_000_000_000;

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

const IDLE: TimerState = {
  status: 'idle',
  session: null,
  lastItemId: 2,
  liveDurationSec: 0,
  mode: 'countup',
  remainingSec: null,
};

/** 计时中（跑在事项 2 上），后面的用例按需改 itemId */
function runningOn(itemId: number): TimerState {
  return { ...IDLE, status: 'running', session: makeRecord({ itemId }), liveDurationSec: 60 };
}

const todo = makeTodo();

beforeEach(() => {
  vi.clearAllMocks();
  useItemStore.setState({ items: [], loaded: true });
  useTodoStore.setState({ todos: [], loaded: true, error: null });
  useTimerStore.setState({ state: IDLE, loaded: true });
  useUiStore.getState().setNotice(null);

  /* `refresh()` 回读的是 store 里的当前快照：本测试关心的是「调了哪些命令、什么顺序」，
     而不是后端真实状态机（那由 Rust 侧 `timer_switch.rs` 覆盖）。 */
  vi.mocked(timerApi.state).mockImplementation(async () => useTimerStore.getState().state);
  vi.mocked(todoApi.list).mockImplementation(async () => useTodoStore.getState().todos);
  vi.mocked(itemApi.list).mockImplementation(async () => useItemStore.getState().items);
  vi.mocked(todoApi.start).mockResolvedValue({} as TimeRecord);
  vi.mocked(todoApi.remove).mockResolvedValue(undefined);
  vi.mocked(itemApi.create).mockResolvedValue(makeItem({ id: 9 }));
  vi.mocked(timerApi.switchItem).mockResolvedValue(runningOn(7));
  vi.mocked(timerApi.pause).mockResolvedValue(makeRecord({ runningSince: null }));
  vi.mocked(timerApi.resume).mockResolvedValue(makeRecord({ itemId: 7 }));
  vi.mocked(timerApi.start).mockResolvedValue(makeRecord({ itemId: 7 }));
});

describe('空闲：整条链路交给后端 todo_start', () => {
  it('只调 todo_start，自己不去换事项、也不自己删待办', async () => {
    const ok = await mobileTimerActions.startTodo(todo);

    expect(ok).toBe(true);
    expect(todoApi.start).toHaveBeenCalledWith(3);
    expect(timerApi.switchItem).not.toHaveBeenCalled();
    /* 软删由 Rust `todo_start` 完成；前端再删一次会撞 TODO_NOT_FOUND */
    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(todoApi.start).toHaveBeenCalledTimes(1);
  });

  it('后端失败（如待办已完成）→ 返回 false 并弹提示', async () => {
    vi.mocked(todoApi.start).mockRejectedValue(new Error('待办不存在'));

    const ok = await mobileTimerActions.startTodo(todo);

    expect(ok).toBe(false);
    expect(useUiStore.getState().notice?.text).toBe('待办不存在');
  });
});

describe('计时中：先换事项，成功了才删待办', () => {
  it('有同名事项 → 直接切到它（仅改归属），随后软删待办', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 7, name: '写周报' })], loaded: true });

    const ok = await mobileTimerActions.startTodo(todo, 'just_switch');

    expect(ok).toBe(true);
    expect(timerApi.switchItem).toHaveBeenCalledWith(7, 'just_switch');
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(todoApi.remove).toHaveBeenCalledWith(3);
    /* 顺序铁律：切换 → 删待办。反了就会出现「待办没了、时间也没记到」 */
    expect(vi.mocked(timerApi.switchItem).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(todoApi.remove).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });

  it('没有同名事项 → 先建同名事项再切过去（与桌面 todo_start 的「无则新建」一致）', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 2, name: '别的事' })], loaded: true });

    const ok = await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(ok).toBe(true);
    expect(itemApi.create).toHaveBeenCalledWith({ name: '写周报' });
    expect(timerApi.switchItem).toHaveBeenCalledWith(9, 'end_and_start');
    expect(todoApi.remove).toHaveBeenCalledWith(3);
  });

  it('切换失败 → 待办绝不能被删，提示照旧弹出来', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 7, name: '写周报' })], loaded: true });
    vi.mocked(timerApi.switchItem).mockRejectedValue(new Error('已有进行中的计时'));

    const ok = await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(ok).toBe(false);
    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice?.text).toBe('已有进行中的计时');
  });

  it('结束并新开失败 → 恢复原计时，不把失败变成静默暂停', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 7, name: '写周报' })], loaded: true });
    vi.mocked(timerApi.switchItem).mockRejectedValue(new Error('IPC 暂时不可用'));
    vi.mocked(timerApi.state).mockResolvedValue({
      ...runningOn(2), status: 'paused', session: makeRecord({ runningSince: null }),
    });

    const ok = await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(ok).toBe(false);
    expect(timerApi.pause).toHaveBeenCalledTimes(1);
    expect(timerApi.resume).toHaveBeenCalledTimes(1);
    expect(todoApi.remove).not.toHaveBeenCalled();
  });

  it('这条待办的事项正是当前计时事项 → 只把待办收走，不动秒表', async () => {
    useTimerStore.setState({ state: runningOn(7), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 7, name: '写周报' })], loaded: true });

    const ok = await mobileTimerActions.startTodo(todo);

    expect(ok).toBe(true);
    expect(timerApi.switchItem).not.toHaveBeenCalled();
    expect(todoApi.remove).toHaveBeenCalledWith(3);
  });
});

describe('同名事项匹配与后端 item::find_by_name 三条口径对齐（P1-1）', () => {
  it('同名事项已归档 → 复用它，绝不新建同名 active 事项', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    /* store 里（选择器口径）看不到归档事项，匹配也不能看 store */
    useItemStore.setState({ items: [], loaded: true });
    vi.mocked(itemApi.list).mockResolvedValue([makeItem({ id: 7, name: '写周报', status: 'archived' })]);

    const ok = await mobileTimerActions.startTodo(todo, 'just_switch');

    expect(ok).toBe(true);
    expect(itemApi.list).toHaveBeenCalledWith({ includeArchived: true });
    /* 新建会造成「同名两个事项」，正是 todo_start.rs 写明要避免的 */
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(timerApi.switchItem).toHaveBeenCalledWith(7, 'just_switch');
  });

  it('同名多条 → 取 id 最小的一条（不是选择器的 is_pinned/sort_order 顺序）', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [], loaded: true });
    /* 后端列表顺序是 is_pinned DESC, sort_order ASC, id ASC：
       被 pin 的 9 号排在前面，但 SQL 要求 ORDER BY id ASC → 应选 4 号 */
    vi.mocked(itemApi.list).mockResolvedValue([
      makeItem({ id: 9, name: '写周报', isPinned: true, sortOrder: 0 }),
      makeItem({ id: 4, name: '写周报', isPinned: false, sortOrder: 3 }),
    ]);

    await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(timerApi.switchItem).toHaveBeenCalledWith(4, 'end_and_start');
    expect(itemApi.create).not.toHaveBeenCalled();
  });

  it('名称必须精确相等（不做大小写 / 空白归一，后端是 COLLATE BINARY）', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [], loaded: true });
    vi.mocked(itemApi.list).mockResolvedValue([makeItem({ id: 7, name: ' 写周报 ' })]);

    await mobileTimerActions.startTodo(todo, 'end_and_start');

    /* 「 写周报 」不等于「写周报」：被判为无同名 → 新建（id 由 mock 给 9）再切过去。
       宁可跟后端一样死板，也不要在前端偷偷 trim 出一套自己的匹配规则。 */
    expect(itemApi.create).toHaveBeenCalledWith({ name: '写周报' });
    expect(timerApi.switchItem).toHaveBeenCalledWith(9, 'end_and_start');
  });

  it('连事项列表都读不到 → 报错收手，不冒险新建一条可能重名的事项', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [], loaded: true });
    vi.mocked(itemApi.list).mockRejectedValue(new Error('读事项失败'));

    const ok = await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(ok).toBe(false);
    expect(itemApi.create).not.toHaveBeenCalled();
    expect(todoApi.remove).not.toHaveBeenCalled();
    expect(useUiStore.getState().notice?.text).toBe('读事项失败');
  });
});

describe('运行中「结束并新开」必须先暂停冻结累计', () => {
  it('running + end_and_start → pause 在 switchItem 之前', async () => {
    useTimerStore.setState({ state: runningOn(2), loaded: true });
    useItemStore.setState({ items: [makeItem({ id: 7, name: '写周报' })], loaded: true });

    await mobileTimerActions.startTodo(todo, 'end_and_start');

    expect(timerApi.pause).toHaveBeenCalledTimes(1);
    expect(vi.mocked(timerApi.pause).mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(timerApi.switchItem).mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER,
    );
  });
});
