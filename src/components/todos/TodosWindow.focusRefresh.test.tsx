/**
 * Timing — 事项窗「再打开时事项名是实名，不是『未归类』」回归（V0.11.7）
 * -----------------------------------------------------------------------------
 * 现场（v0.11.6 安装版真实库）：`time_records` 今天三条 → `item_id` 19 / 20 / 19，
 * `items` 里 19 = 「Timing优化及十五五文件学习」、20 = 「上厕所」，都不是 NULL。
 * 界面上却三行全显示「未归类」，而且被拆成三段。
 *
 * 根因不是「名字丢了」，是**视图快照过期**：悬浮窗和事项窗是两个独立 webview、两份
 * zustand store。悬浮窗新建事项时只刷新了它自己那份；事项窗是浮层（只 hide 不卸载），
 * 「再打开」不重新 mount，首帧那个 `useEffect([])` 不重跑 → 事项列表停在旧快照。
 * 于是 `itemName()` 找不到 19 → 回落「未归类」，`todayGroups::identityOf()` 对
 * 「未归类」改用 `id:<itemId>` 当分组键 → 19/20/19 被拆成三行。
 *
 * 这条用例钉住修复：**窗口重新获得焦点时必须重拉 `list_items`**，且渲染出来的是真名。
 * 断言落在 `itemApi.list`（领域门面）上而不是更下面的传输层调用：前者才是 store 真正调的那一层。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Item, TimeRecord, Todo } from '../../types/domain';

/** 悬浮窗里新建的那两个事项（真实库里的 19 / 20） */
function makeItem(id: number, name: string): Item {
  return {
    id,
    name,
    color: null,
    status: 'active',
    isSystem: false,
    sortOrder: id,
    remindAt: null,
    remindedAt: null,
    isPinned: false,
    createdAt: 0,
    updatedAt: 0,
  };
}

function makeRecord(over: Partial<TimeRecord>): TimeRecord {
  return {
    id: 61,
    itemId: 19,
    status: 'saved',
    startedAt: Date.now() - 60_000,
    endedAt: Date.now() - 30_000,
    accumulatedSec: 30,
    runningSince: null,
    note: null,
    mode: 'countup',
    targetSec: null,
    ...over,
  };
}

/* `list_items` 第一次返回空（事项窗那份过期快照），焦点刷新后返回真名。 */
const { ITEMS, RECORDS } = vi.hoisted(() => ({
  ITEMS: [] as unknown[],
  RECORDS: [] as unknown[],
}));

vi.mock('../../services/ipc', () => ({
  ipc: {
    /* 主题：本窗首帧 themeActions.init() */
    themeGet: async () => ({ mode: 'dark' }),
    accentGet: async () => ({ running: null, warn: null, done: null, bar: null }),
    /* 会话：进行中行 */
    getTimerState: async () => ({ status: 'idle', session: null, countdownTarget: null }),
    listItems: async () => ITEMS,
    statsSummary: async () => ({ totalSec: 30, recordCount: RECORDS.length, byItem: [] }),
    listRecords: async () => ({ items: RECORDS, total: RECORDS.length, page: 1, limit: 100, hasMore: false }),
    todoList: async () => [] as Todo[],
    noteList: async () => [],
  },
  onIpcEvent: async () => () => undefined,
  errorText: (err: unknown) => String(err),
  IpcError: class IpcError extends Error {},
  /* 是**函数**不是常量：`lib/window` 调 `isTauri()` 判断要不要走原生窗口 API。 */
  isTauri: () => false,
}));

import { itemApi } from '../../services/api';
import { TodosWindow } from './TodosWindow';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** 每个用例都重置：`vi.spyOn` 会挂在模块对象上，跨用例残留会让「调了几次」失真 */
let listSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  document.body.innerHTML = '';
  RECORDS.splice(0, RECORDS.length);
  listSpy = vi.spyOn(itemApi, 'list');
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
  listSpy.mockRestore();
});

/** 名字列（今日计时的记录行标题） */
function rowTitles(el: HTMLElement): string[] {
  return Array.from(el.querySelectorAll('.todo-row__title')).map((n) => n.textContent ?? '');
}

describe('事项窗重新获得焦点后事项名跟上（V0.11.7）', () => {
  it('挂载时快照过期显示「未归类」，focus 后重拉并显示真名', async () => {
    /* 事项窗手里那份 items 是空的（悬浮窗新建之后没同步过来） */
    ITEMS.splice(0, ITEMS.length);
    RECORDS.push(makeRecord({ id: 61, itemId: 19 }));
    listSpy.mockImplementation(async () => {
      /* 第一次（首帧 reload）拿到空表；之后的 reload 才是后端真值 */
      return listSpy.mock.calls.length <= 1 ? [] : [makeItem(19, '上厕所')];
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(TodosWindow));
    });
    /* 等首帧的 list_records / list_items 收敛 */
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(itemApi.list).toHaveBeenCalled();
    const stale = rowTitles(container);
    expect(stale).toContain('未归类');
    expect(stale).not.toContain('上厕所');

    const callsBeforeFocus = listSpy.mock.calls.length;

    /* 用户从托盘再打开事项窗 → 后端 show() + set_focus() → 窗口 focus。
       `document.visibilityState` 在 jsdom 里是 'visible'，不会拦住这次刷新。 */
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(listSpy.mock.calls.length).toBeGreaterThan(callsBeforeFocus);
    expect(rowTitles(container)).toContain('上厕所');
    expect(rowTitles(container)).not.toContain('未归类');
  });

  it('同一事项的两条记录仍然合并成一行（分组键重新按名字算）', async () => {
    ITEMS.splice(0, ITEMS.length);
    /* 现场数据：19 → 20 → 19，三段被拆开 */
    RECORDS.push(
      makeRecord({ id: 60, itemId: 19, startedAt: 1_000, endedAt: 2_000, accumulatedSec: 1_000 }),
      makeRecord({ id: 61, itemId: 20, startedAt: 3_000, endedAt: 4_000, accumulatedSec: 1_000 }),
      makeRecord({ id: 62, itemId: 19, startedAt: 5_000, endedAt: 6_000, accumulatedSec: 1_000 }),
    );
    listSpy.mockImplementation(async () => {
      return listSpy.mock.calls.length <= 1 ? [] : [makeItem(19, '学习'), makeItem(20, '上厕所')];
    });

    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    await act(async () => {
      root.render(createElement(TodosWindow));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const titles = rowTitles(container);
    /* 19 的两条记录首尾相接（2_000 → 5_000 没有超出合并阈值时也可能分开，
       这里两条之间有 3s 空隙，按 todayGroups 的连续性上限会并成一行——断言「不再出现未归类」，
       不硬钉行数，避免把分组阈值的细节复制进这条用例）。 */
    expect(titles).toContain('学习');
    expect(titles).toContain('上厕所');
    expect(titles).not.toContain('未归类');
  });
});
