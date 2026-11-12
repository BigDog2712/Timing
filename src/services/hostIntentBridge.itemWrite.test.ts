/**
 * Timing — 意图执行端：**时间线卡的写意图**（[本轮] 「事项管理」扩了载荷）
 * -----------------------------------------------------------------------------
 * 「新建事项 / 事项管理」在分析窗里都只是 `patina:host-intent` 的一条意图
 * （分析窗一条写命令都没有）。真正落库的只有这里：`itemApi.create` / `itemApi.update` /
 * `settingsApi.update`。
 *
 * 判据钉的是**载荷**，不是"函数被调过"：
 *   ① `create_item` 直接用载荷里的名字建，**不**走 `ensureItemByName`（那条会先按名匹配
 *      已有事项 → 用户在弹层里点"新建"会被静默变成"复用同名事项"），随后 `reload()`；
 *   ② 勾了「设为常用」→ 再发一条 `itemApi.update({ id, patch: { isPinned, sortOrder } })`；
 *      填了默认时长 → `settingsApi.update({ itemsTimers })`（itemId → 分钟，落 KV 不建表）；
 *   ③ `update_item` 只把**给了的字段**拼进 patch，`id` 来自意图本身
 *      （变异自证：换成常量 `0` → 下列断言立刻红）；`timerMinutes` 三态：
 *      缺省 = 不改，`null` = 清键，数字 = 写值；
 *   ④ 纯空白名字两侧都丢掉，不落到 IPC；
 *   ⑤ 失败只弹药丸上的 `setNotice({tone:'danger'})`，不跨窗。
 *
 * 为什么单独一个文件：宿主侧的 `hostIntentBridge.test.ts` 贴着单文件 300 行上限，
 * 这些意图的用例另起一份，夹具也只留这里真正用到的几个模块。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Intent =
  | { action: 'create_item'; name: string; isPinned?: boolean; timerMinutes?: number | null; sortOrder?: number }
  | {
    action: 'update_item';
    id: number;
    name?: string;
    isPinned?: boolean;
    sortOrder?: number;
    timerMinutes?: number | null;
  };

const h = vi.hoisted(() => ({
  handler: null as ((intent: Intent) => void) | null,
  event: '' as string,
  startOrSwitch: vi.fn(async () => undefined),
  togglePause: vi.fn(async () => undefined),
  createItem: vi.fn(async (_params: { name: string }) => ({ id: 42, name: '写代码' })),
  updateItem: vi.fn(async (_params: { id: number; patch: Record<string, unknown> }) => ({ id: 7, name: '开会' })),
  updateSettings: vi.fn(async (_patch: Record<string, unknown>) => ({ itemsTimers: {} })),
  setSettings: vi.fn(),
  settings: { itemsTimers: {} as Record<string, number> },
  reloadItems: vi.fn(async () => []),
  setNotice: vi.fn(),
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
vi.mock('./api', () => ({
  itemApi: { create: h.createItem, update: h.updateItem },
  settingsApi: { update: h.updateSettings },
}));
vi.mock('./highlightActions', () => ({ highlightPill: vi.fn(async () => undefined) }));
vi.mock('./todosActions', () => ({ openTodosWindow: vi.fn(async () => undefined) }));
vi.mock('./noteActions', () => ({
  openNoteWindowFor: vi.fn(async () => undefined),
  removeNote: vi.fn(async () => undefined),
}));
vi.mock('./settingsActions', () => ({ openSettings: vi.fn(async () => undefined) }));
vi.mock('./ipc', () => ({
  errorText: (err: unknown) => `错误：${String(err)}`,
  ipc: { showWindow: vi.fn(async () => undefined), createRecord: vi.fn(async () => []) },
}));
vi.mock('../stores/itemStore', () => ({
  useItemStore: { getState: () => ({ items: h.items, reload: h.reloadItems }) },
}));
vi.mock('../stores/settingsStore', () => ({
  /* `loaded: true` = 热启动：`itemTimerWrite` 只在冷启动（`loaded=false`）时才先 `reload()` */
  useSettingsStore: {
    getState: () => ({
      loaded: true,
      settings: h.settings,
      setSettings: h.setSettings,
      reload: vi.fn(async () => h.settings),
    }),
  },
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: {
    getState: () => ({
      setNotice: h.setNotice,
      openPanel: vi.fn(),
      setCollapsed: vi.fn(),
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

const allMocks = () => [
  h.startOrSwitch, h.togglePause, h.createItem, h.updateItem,
  h.updateSettings, h.setSettings, h.reloadItems, h.setNotice,
];

beforeEach(() => {
  h.settings = { itemsTimers: {} };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root.render(createElement(Harness)));
  for (const fn of allMocks()) fn.mockClear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function dispatch(intent: Intent) {
  await act(async () => { h.handler?.(intent); });
  await act(async () => { await Promise.resolve(); });
}

describe('useHostIntentBridge · 时间线卡的写意图', () => {
  it('tl01_listens_on_the_documented_event_name', () => {
    expect(h.event).toBe('patina:host-intent');
  });

  it('tl02_create_item_creates_with_the_intent_name_and_reloads', async () => {
    /* 已有同名事项：这条意图**仍然**要新建（用户明确说了"新建"） */
    h.items = [{ id: 7, name: '写代码' }];

    await dispatch({ action: 'create_item', name: '写代码' });

    expect(h.createItem).toHaveBeenCalledTimes(1);
    expect(h.createItem).toHaveBeenCalledWith({ name: '写代码' });
    /* 没给 pin / timer：一条多余的事项写都不该发生 */
    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.updateSettings).not.toHaveBeenCalled();
    /* 不刷新 → 药丸的事项菜单/常用事项框里看不到它，下一次同名意图还会再建一条 */
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
    /* 新建不是"开始计时" */
    expect(h.startOrSwitch).not.toHaveBeenCalled();
    expect(h.togglePause).not.toHaveBeenCalled();
  });

  it('tl03_create_item_with_a_blank_name_is_ignored', async () => {
    await dispatch({ action: 'create_item', name: '   ' });

    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.reloadItems).not.toHaveBeenCalled();
  });

  it('tl04_update_item_patches_only_the_name_for_the_intent_id', async () => {
    await dispatch({ action: 'update_item', id: 7, name: '开会' });

    expect(h.updateItem).toHaveBeenCalledTimes(1);
    /* 整个载荷逐字钉：`id` 来自意图（换成常量 0 就红），patch 里只有 name */
    expect(h.updateItem).toHaveBeenCalledWith({ id: 7, patch: { name: '开会' } });
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
    expect(h.createItem).not.toHaveBeenCalled();
    expect(h.startOrSwitch).not.toHaveBeenCalled();
  });

  it('tl05_update_item_keeps_the_exact_id_for_another_item', async () => {
    await dispatch({ action: 'update_item', id: 31, name: '摸鱼' });

    expect(h.updateItem).toHaveBeenCalledWith({ id: 31, patch: { name: '摸鱼' } });
  });

  it('tl06_update_item_with_a_blank_name_is_ignored', async () => {
    await dispatch({ action: 'update_item', id: 7, name: '  ' });

    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.reloadItems).not.toHaveBeenCalled();
  });

  it('tl07_failures_surface_on_the_pill_not_across_windows', async () => {
    h.createItem.mockRejectedValueOnce(new Error('ITEM_NAME_TOO_LONG'));
    await dispatch({ action: 'create_item', name: 'x'.repeat(200) });
    expect(h.setNotice).toHaveBeenCalledTimes(1);
    expect(h.setNotice.mock.calls[0]?.[0]).toMatchObject({ tone: 'danger' });

    h.setNotice.mockClear();
    h.updateItem.mockRejectedValueOnce(new Error('ITEM_NOT_FOUND'));
    await dispatch({ action: 'update_item', id: 7, name: '开会' });
    expect(h.setNotice).toHaveBeenCalledTimes(1);
    expect(h.setNotice.mock.calls[0]?.[0]).toMatchObject({ tone: 'danger' });
  });

  /* ── [本轮] 事项管理新增的字段 ───────────────────────────────────────── */

  it('tl08_create_item_with_pin_and_timer_writes_item_patch_and_settings', async () => {
    await dispatch({
      action: 'create_item',
      name: '看论文',
      isPinned: true,
      timerMinutes: 25,
      sortOrder: 5,
    });

    expect(h.createItem).toHaveBeenCalledWith({ name: '看论文' });
    /* 用**新建出来的 id**（42），不是意图里的任何东西 */
    expect(h.updateItem).toHaveBeenCalledWith({ id: 42, patch: { isPinned: true, sortOrder: 5 } });
    /* 时长落 settings.itemsTimers（itemId → 分钟），并且把宿主返回的快照写回 store */
    expect(h.updateSettings).toHaveBeenCalledWith({ itemsTimers: { '42': 25 } });
    expect(h.setSettings).toHaveBeenCalledWith({ itemsTimers: {} });
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
  });

  it('tl09_create_item_without_a_pin_leaves_the_item_patch_empty', async () => {
    await dispatch({ action: 'create_item', name: '看论文', isPinned: false, timerMinutes: null });

    expect(h.createItem).toHaveBeenCalledWith({ name: '看论文' });
    /* `isPinned: false` 也要写（用户明确选了"不设为常用"），但不该带 sortOrder */
    expect(h.updateItem).toHaveBeenCalledWith({ id: 42, patch: { isPinned: false } });
    /* `timerMinutes: null` = 明确不设时长 → 写一次设置（清键），而不是留着旧值 */
    expect(h.updateSettings).toHaveBeenCalledWith({ itemsTimers: {} });
  });

  it('tl10_update_item_sends_only_the_fields_it_was_given', async () => {
    await dispatch({ action: 'update_item', id: 7, isPinned: false });

    expect(h.updateItem).toHaveBeenCalledTimes(1);
    expect(h.updateItem).toHaveBeenCalledWith({ id: 7, patch: { isPinned: false } });
    expect(h.updateSettings).not.toHaveBeenCalled();
  });

  it('tl11_update_item_clears_the_timer_without_touching_the_item_row', async () => {
    h.settings = { itemsTimers: { '7': 30, '9': 10 } };
    await dispatch({ action: 'update_item', id: 7, timerMinutes: null });

    expect(h.updateItem).not.toHaveBeenCalled();
    /* `null` 删掉这个键，别的事项的时长原样保留 */
    expect(h.updateSettings).toHaveBeenCalledWith({ itemsTimers: { '9': 10 } });
    expect(h.reloadItems).toHaveBeenCalledTimes(1);
  });

  it('tl12_update_item_with_nothing_to_change_issues_no_ipc_at_all', async () => {
    await dispatch({ action: 'update_item', id: 7 });

    expect(h.updateItem).not.toHaveBeenCalled();
    expect(h.updateSettings).not.toHaveBeenCalled();
    expect(h.reloadItems).not.toHaveBeenCalled();
  });
});
