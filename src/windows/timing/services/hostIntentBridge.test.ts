/**
 * Timing — P0-04/P0-05 意图执行端（药丸侧）的判据
 * -----------------------------------------------------------------------------
 * 分析窗那条 `patina:host-intent` 发出去之后，真正改数据的只有这里。它一旦分派错，
 * 症状都是「跨窗静默不达」：分析窗点了没反应、或者更糟——新建了一条重名事项。
 *
 * 钉六件事：① 命中同名事项 → 不新建直接用；② 没有同名事项 → 先建再开始并刷新列表
 * （不刷新会反复重名）；③ `toggle_timer` 走 `togglePause`（方向由药丸读自身状态决定）；
 * ④ `show_pill` = 展开 + 显示 + 复用托盘那套高亮（颜色只在一处读）；⑤ 不认识的动作忽略
 * （分析窗比药丸新时不能炸）；⑥ `sync_app_item_bindings` 真的落到宿主的 `item_app`。
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
  | { action: 'open_todos' }
  | { action: 'delete_note'; noteId: number }
  /* [0.13 fix] 分析窗的「事项↔应用」绑定 → 宿主 `item_app`（自动接管只认这张表） */
  | { action: 'sync_app_item_bindings'; appKey: string; itemIds: readonly number[]; track?: number };

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
  openNote: vi.fn(async () => undefined),
  removeNote: vi.fn(async () => undefined),
  openSettings: vi.fn(async () => undefined),
  highlightPill: vi.fn(async () => undefined),
  listItemsForApp: vi.fn(async () => [] as { itemId: number; track: number }[]),
  bindItemApp: vi.fn(async () => undefined),
  unbindItemApp: vi.fn(async () => undefined),
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
/* [便利贴可删除] 删除必须落到既有 `removeNote(id)`（note_delete + 关窗）：自己重写会绕开
   失败提示，所以连模块一起换桩。 */
vi.mock('./noteActions', () => ({
  openNoteWindowFor: h.openNote,
  removeNote: h.removeNote,
}));
/* [0.12.1 T04b] 设置只剩一个家：这条意图现在与托盘/菜单/手柄同走 `openSettings()`。 */
vi.mock('./settingsActions', () => ({ openSettings: h.openSettings }));
vi.mock('./ipc', () => ({
  errorText: (err: unknown) => `错误：${String(err)}`,
  ipc: {
    showWindow: h.showWindow,
    createRecord: h.createRecord,
    listItemsForApp: h.listItemsForApp,
    bindItemApp: h.bindItemApp,
    unbindItemApp: h.unbindItemApp,
  },
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
    h.openTodos, h.openNote, h.removeNote, h.listItemsForApp, h.bindItemApp, h.unbindItemApp,
  ]) fn.mockClear();
  h.items = [];
  h.listItemsForApp.mockResolvedValue([]);
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
    expect(h.highlightPill).toHaveBeenCalledTimes(1); /* 复用托盘那条处理函数 */
  });

  it('p006_open_host_settings_goes_through_the_single_settings_entry', async () => {
    await dispatch({ action: 'open_host_settings' });

    /* 内联设置面板下线后与托盘 / 菜单 / 手柄 'settings.open' 走同一入口，不再动 panel 状态。 */
    expect(h.openSettings).toHaveBeenCalledTimes(1);
    expect(h.openPanel).not.toHaveBeenCalled();
  });

  /* 今日概览待办卡点行体：与药丸菜单同一条路（单例窗），不新建 IPC 命令 */
  it('p008_open_todos_reuses_the_single_window_path', async () => {
    await dispatch({ action: 'open_todos' });

    expect(h.openTodos).toHaveBeenCalledTimes(1);
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  /* ---- [便利贴可删除] 删除意图 ---- */

  /* `delete_note` 必须把**意图里的那个 id** 原样交给 `removeNote`。变异自证：换成常量 0 → 红。 */
  it('n01_delete_note_runs_remove_note_with_the_intent_id', async () => {
    await dispatch({ action: 'delete_note', noteId: 42 });

    expect(h.removeNote).toHaveBeenCalledTimes(1);
    expect(h.removeNote).toHaveBeenCalledWith(42);
    /* 删除不碰计时状态机、不建事项 —— 它是纯粹的便利贴动作 */
    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.togglePause).not.toHaveBeenCalled();
    expect(h.createItem).not.toHaveBeenCalled();
  });

  it('n02_delete_note_keeps_the_exact_id_for_another_note', async () => {
    await dispatch({ action: 'delete_note', noteId: 7 });

    expect(h.removeNote).toHaveBeenCalledWith(7);
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

  /* ---- [0.13 fix] 事项 ↔ 应用绑定的镜像写 ---- */

  /* `sync_app_item_bindings` 必须真的落到宿主的 `bind_item_app` / `unbind_item_app`：自动接管
     只读 `item_app`，这条 case 写错一个字母就是"绑了不计时"且两端零日志。变异自证：把 switch
     里那个 case 改个字（或删掉一支）→ 本用例红（在此之前全套仍是全绿，QA 的中-1 指的就是这里）。 */
  it('p00c_sync_app_item_bindings_mirrors_the_full_set_through_host_ipc', async () => {
    h.listItemsForApp.mockResolvedValue([{ itemId: 9, track: 1 }]); // 宿主有 9（要解绑）、缺 5 与 7
    await dispatch({ action: 'sync_app_item_bindings', appKey: 'yanyun.exe', itemIds: [5, 7] });
    expect(h.bindItemApp).toHaveBeenCalledWith({ itemId: 5, appKey: 'yanyun.exe', track: 1 });
    expect(h.bindItemApp).toHaveBeenCalledWith({ itemId: 7, appKey: 'yanyun.exe', track: 1 });
    /* 载荷是全集的含义就在这里：不在集合里的那条必须解绑；且镜像写不碰计时状态机 */
    expect(h.unbindItemApp).toHaveBeenCalledWith({ itemId: 9, appKey: 'yanyun.exe' });
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it('p004_unknown_action_from_a_newer_analysis_window_is_ignored', async () => {
    await dispatch({ action: 'no_such_action' } as unknown as Intent);

    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.togglePause).not.toHaveBeenCalled();
    expect(h.setNotice).not.toHaveBeenCalled();
  });
});
