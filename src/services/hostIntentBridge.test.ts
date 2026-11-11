/**
 * Timing — P0-04/P0-05 意图执行端（药丸侧）的判据
 * -----------------------------------------------------------------------------
 * 分析窗那条 `patina:host-intent` 发出去之后，真正改数据的只有这里。它一旦分派错，
 * 症状都是「跨窗静默不达」：分析窗点了没反应、或者更糟——新建了一条重名事项。
 *
 * 钉五件事：
 *  ① `start_timer_for_activity` 命中同名事项 → **不新建**，直接用它的 id 开始；
 *  ② 没有同名事项 → 先 `createItem({name})` 再开始，并刷新事项列表（不刷新会反复重名）；
 *  ③ `toggle_timer` 走 `togglePause`（方向由药丸读自身状态决定，分析窗不猜）；
 *  ④ `show_pill` = 展开 + 显示窗口 + 复用托盘那套高亮（颜色只在一处读）；
 *  ⑤ 不认识的动作**忽略**（分析窗比药丸新时不能炸）。
 *
 * 这也顺带证明了「分析窗没有写命令」这条边界是**真的**：本文件里所有写操作都是宿主的
 * `itemApi` / `useTimerActions`，分析窗那边一条都没有。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Intent =
  | { action: 'start_timer_for_activity'; itemName: string }
  | { action: 'backfill_record'; itemName: string; startedAt: number; endedAt: number }
  | { action: 'toggle_timer' }
  | { action: 'open_host_settings' }
  | { action: 'show_pill' }
  | { action: 'open_todos' };

const h = vi.hoisted(() => ({
  handler: null as ((intent: Intent) => void) | null,
  event: '' as string,
  startOrSwitch: vi.fn(async () => undefined),
  togglePause: vi.fn(async () => undefined),
  createItem: vi.fn(async () => ({ id: 42, name: 'VS Code' })),
  createRecord: vi.fn(async () => []),
  reloadItems: vi.fn(async () => []),
  showWindow: vi.fn(async () => undefined),
  openTodos: vi.fn(async () => undefined),
  openSettings: vi.fn(async () => undefined),
  highlightPill: vi.fn(async () => undefined),
  setNotice: vi.fn(),
  openPanel: vi.fn(),
  setCollapsed: vi.fn(),
  items: [] as { id: number; name: string }[],
}));

vi.mock('../hooks/useTauriEvent', () => ({
  useTauriEvent: (event: string, handler: (intent: Intent) => void) => {
    h.event = event;
    h.handler = handler;
  },
}));
vi.mock('../hooks/useTimerActions', () => ({
  useTimerActions: () => ({ startOrSwitch: h.startOrSwitch, togglePause: h.togglePause }),
}));
vi.mock('./api', () => ({ itemApi: { create: h.createItem } }));
vi.mock('./highlightActions', () => ({ highlightPill: h.highlightPill }));
vi.mock('./todosActions', () => ({ openTodosWindow: h.openTodos }));
/* [0.12.1 T04b] 设置只剩一个家：这条意图现在与托盘/菜单/手柄同走 `openSettings()`。 */
vi.mock('./settingsActions', () => ({ openSettings: h.openSettings }));
vi.mock('./ipc', () => ({
  errorText: (err: unknown) => `错误：${String(err)}`,
  ipc: { showWindow: h.showWindow, createRecord: h.createRecord },
}));
vi.mock('../stores/itemStore', () => ({
  useItemStore: {
    getState: () => ({ items: h.items, reload: h.reloadItems }),
  },
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    getState: () => ({
      setNotice: h.setNotice,
      openPanel: h.openPanel,
      setCollapsed: h.setCollapsed,
    }),
  },
}));

const { useHostIntentBridge } = await import('./hostIntentBridge');

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useHostIntentBridge();
  return null;
}

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  for (const fn of [
    h.startOrSwitch, h.togglePause, h.createItem, h.reloadItems, h.createRecord,
    h.showWindow, h.highlightPill, h.setNotice, h.openPanel, h.setCollapsed, h.openSettings,
  ]) fn.mockClear();
  h.items = [];
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 把一条意图喂进去并等异步链跑完（`void handleXxx(...)` 是 fire-and-forget）。 */
async function dispatch(intent: Intent) {
  await act(async () => {
    h.handler?.(intent);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

describe('useHostIntentBridge（P0-04 / P0-05 执行端）', () => {
  it('p005_listens_on_the_documented_event_name', () => {
    /* 两侧各写一份字符串（L9 禁止跨窗 import），所以名字本身必须被钉住 */
    expect(h.event).toBe('patina:host-intent');
  });

  it('p005_reuses_an_existing_item_without_creating_a_duplicate', async () => {
    h.items = [{ id: 7, name: 'vs code' }];

    await dispatch({ action: 'start_timer_for_activity', itemName: 'VS Code' });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.reloadItems).not.toHaveBeenCalled();
    expect(h.startOrSwitch).toHaveBeenCalledTimes(1);
    expect(h.startOrSwitch).toHaveBeenCalledWith(7);
  });

  it('p005_creates_the_item_by_app_name_when_missing_then_starts', async () => {
    await dispatch({ action: 'start_timer_for_activity', itemName: 'VS Code' });

    expect(h.createItem).toHaveBeenCalledTimes(1);
    expect(h.createItem).toHaveBeenCalledWith({ name: 'VS Code' });
    /* 不刷新事项列表 → 下一次同样的意图又判成「没有同名事项」，会建出第二条重名 */
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
    expect(h.startOrSwitch).toHaveBeenCalledWith(42);
  });

  it('p005_start_failure_surfaces_on_the_pill_not_across_windows', async () => {
    h.createItem.mockRejectedValueOnce(new Error('ITEM_NAME_EMPTY'));

    await dispatch({ action: 'start_timer_for_activity', itemName: 'VS Code' });

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.setNotice).toHaveBeenCalledTimes(1);
    expect(h.setNotice.mock.calls[0]?.[0]).toMatchObject({ tone: 'danger' });
  });

  it('p005_blank_item_name_is_ignored', async () => {
    await dispatch({ action: 'start_timer_for_activity', itemName: '   ' });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it('p004_toggle_timer_defers_direction_to_the_pill', async () => {
    await dispatch({ action: 'toggle_timer' });

    expect(h.togglePause).toHaveBeenCalledTimes(1);
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it('p004_show_pill_expands_shows_and_reuses_the_highlight_path', async () => {
    await dispatch({ action: 'show_pill' });

    expect(h.setCollapsed).toHaveBeenCalledWith(false);
    expect(h.showWindow).toHaveBeenCalledTimes(1);
    /* 复用托盘双击那条处理函数：高亮颜色只在一处读，不会出现两套取色 */
    expect(h.highlightPill).toHaveBeenCalledTimes(1);
  });

  it('p006_open_host_settings_goes_through_the_single_settings_entry', async () => {
    await dispatch({ action: 'open_host_settings' });

    /* 内联设置面板下线后，这条意图不再去动药丸的 panel 状态（那一支已经不存在了），
       而是和托盘 / 菜单 / 手柄 'settings.open' 走同一个入口。 */
    expect(h.openSettings).toHaveBeenCalledTimes(1);
    expect(h.openPanel).not.toHaveBeenCalled();
  });

  /* 今日概览待办卡点行体：与药丸菜单同一条路（单例窗，已开则前置），不新建 IPC 命令 */
  it('p008_open_todos_reuses_the_single_window_path', async () => {
    await dispatch({ action: 'open_todos' });

    expect(h.openTodos).toHaveBeenCalledTimes(1);
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  /* ---- P1-01 补记 ---- */

  /* 判据①：补记走 `createRecord`，起止 = 传进来的段起止（不是「现在」） */
  it('p101_backfill_writes_a_record_with_the_segment_bounds', async () => {
    h.items = [{ id: 7, name: 'vs code' }];

    await dispatch({ action: 'backfill_record', itemName: 'VS Code', startedAt: 1000, endedAt: 5000 });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.createRecord).toHaveBeenCalledTimes(1);
    expect(h.createRecord).toHaveBeenCalledWith({ itemId: 7, startedAt: 1000, endedAt: 5000, note: null });
  });

  /* 判据⑤（行为侧）：补记**不碰**计时状态机 —— 不开始、不暂停、不切换 */
  it('p101_backfill_never_touches_the_timer_state_machine', async () => {
    await dispatch({ action: 'backfill_record', itemName: 'VS Code', startedAt: 1000, endedAt: 5000 });

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.togglePause).not.toHaveBeenCalled();
    expect(h.createRecord).toHaveBeenCalledTimes(1);
  });

  it('p101_backfill_creates_the_item_when_missing_then_writes', async () => {
    await dispatch({ action: 'backfill_record', itemName: 'VS Code', startedAt: 1000, endedAt: 5000 });

    expect(h.createItem).toHaveBeenCalledWith({ name: 'VS Code' });
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
    expect(h.createRecord).toHaveBeenCalledWith({ itemId: 42, startedAt: 1000, endedAt: 5000, note: null });
  });

  it('p101_backfill_failure_surfaces_on_the_pill', async () => {
    h.createRecord.mockRejectedValueOnce(new Error('INVALID_DURATION'));

    await dispatch({ action: 'backfill_record', itemName: 'VS Code', startedAt: 1000, endedAt: 5000 });

    expect(h.setNotice).toHaveBeenCalledTimes(1);
    expect(h.setNotice.mock.calls[0]?.[0]).toMatchObject({ tone: 'danger' });
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it('p101_backfill_with_a_blank_name_is_ignored', async () => {
    await dispatch({ action: 'backfill_record', itemName: '  ', startedAt: 1000, endedAt: 5000 });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.createRecord).not.toHaveBeenCalled();
  });

  /* 判据③的宿主半场：分析窗递来的是**建议命中的那个事项名**，宿主按精确名一找就命中，
     于是「复用」而不是「新建」——事项表条数不变。变异：让弹卡递活动原名 → 这里会
     `createItem('VS Code')` → 事项表 +1。 */
  it('p106_host_reuses_the_suggested_item_name_without_adding_one', async () => {
    h.items = [{ id: 7, name: 'VS Code 调试' }];

    await dispatch({ action: 'backfill_record', itemName: 'VS Code 调试', startedAt: 1000, endedAt: 5000 });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.createRecord).toHaveBeenCalledWith({ itemId: 7, startedAt: 1000, endedAt: 5000, note: null });
  });

  it('p004_unknown_action_from_a_newer_analysis_window_is_ignored', async () => {
    await dispatch({ action: 'no_such_action' } as unknown as Intent);

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.togglePause).not.toHaveBeenCalled();
    expect(h.setNotice).not.toHaveBeenCalled();
  });
});
