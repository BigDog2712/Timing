/**
 * RecoverDialog —— 批 2（V0.11.24）异常退出恢复改造的 DOM / 文案判据。
 *
 * 覆盖（PRD §13.5）：
 *   - H1：标题逐字 `上次计时没有正常结束`；元信息同时含 `HH:MM 开始` 与 `HH:MM 关闭`；
 *   - H4：暂停中崩溃只有 `结束并保存（…）` 一个按钮，元信息逐字 `09:12 开始，已暂停`；
 *   - H6：Esc 执行次按钮（`结束在 …`），不是继续计时；
 *   - 三元素记账：复选框 0 命中，可交互元素 = 2 主按钮 + 1 文字动作；
 *   - 选项 B 的结束时刻取**关闭时间**（`runningSince`），不是 now（本轮唯一行为变化点）。
 *
 * 渲染走真实 DOM（`createRoot` + `act`，同 UndoBar 的取向：zustand v5 在 SSR 下读不到状态）。
 * 传输层用 `vi.mock` 整体替换（L1 分层：组件目录不触碰传输层），入参记进 `CALLS` 后断言。
 */
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useItemStore } from '../../stores/itemStore';
import { useUiStore } from '../../stores/uiStore';
import type { Item, TimeRecord } from '../../types/domain';
import { RecoverDialog } from './RecoverDialog';

/* React 19 的 act() 需要这个全局标记，否则每次 act 都会打一条 deprecation 警告 */
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 每次 `resolve_open_record` 的入参（模块 mock 与断言之间只经这里握手） */
const { CALLS } = vi.hoisted(() => ({ CALLS: [] as unknown[] }));

vi.mock('../../services/ipc', () => ({
  ipc: {
    resolveOpenRecord: async (params: unknown) => {
      CALLS.push(params);
      return null;
    },
    getTimerState: async () => ({
      status: 'idle',
      session: null,
      lastItemId: 1,
      liveDurationSec: 0,
      mode: 'countup',
      remainingSec: null,
    }),
  },
  onIpcEvent: async () => () => undefined,
  errorText: (err: unknown) => String(err),
  IpcError: class IpcError extends Error {},
  isTauri: () => false,
}));

/** 当天本地 09:12 / 18:40 / 20:00 的毫秒时间戳（formatClockTime 是本地时区，用例自洽） */
const TODAY = new Date();
const START_AT = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 9, 12).getTime();
const CLOSE_AT = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 18, 40).getTime();
const NOW = new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 20, 0).getTime();
/** 09:12 → 18:40 计了 4:12:30（15150s）；18:40 → 20:00 空档 1:20:00（4800s）；A 读数 5:32:30 */
const ACCUM_SEC = 4 * 3600 + 12 * 60 + 30;

const ITEM: Item = {
  id: 1,
  name: '写周报',
  color: null,
  status: 'active',
  isSystem: false,
  sortOrder: 0,
  remindAt: null,
  remindedAt: null,
  isPinned: false,
  createdAt: START_AT,
  updatedAt: START_AT,
};

const RUNNING_SESSION: TimeRecord = {
  id: 7,
  itemId: 1,
  status: 'active',
  startedAt: START_AT,
  endedAt: null,
  accumulatedSec: ACCUM_SEC,
  runningSince: CLOSE_AT,
  note: null,
  mode: 'countup',
  targetSec: null,
};

const PAUSED_SESSION: TimeRecord = { ...RUNNING_SESSION, runningSince: null };

let container: HTMLDivElement;
let root: Root;

async function mount(session: TimeRecord): Promise<void> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(RecoverDialog, { session }));
  });
}

function buttonByText(fragment: string): HTMLButtonElement | null {
  const nodes = Array.from(container.querySelectorAll('button'));
  return nodes.find((b) => b.textContent?.includes(fragment)) ?? null;
}

function texts(): string[] {
  return Array.from(container.querySelectorAll('button')).map((b) => b.textContent ?? '');
}

function lastCall(): Record<string, unknown> {
  const last = CALLS.at(-1);
  if (last == null) throw new Error('resolveOpenRecord 没有被调用');
  return last as Record<string, unknown>;
}

describe('RecoverDialog —— 计时中崩溃（双主按钮分支）', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    CALLS.length = 0;
    useItemStore.setState({ items: [ITEM] });
    useUiStore.setState({ recover: RUNNING_SESSION, notice: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    vi.restoreAllMocks();
  });

  it('H1：标题逐字，元信息同时含「09:12 开始」与「18:40 关闭」', async () => {
    await mount(RUNNING_SESSION);
    expect(container.querySelector('.dialog__title')?.textContent).toBe('上次计时没有正常结束');
    const meta = container.querySelector('.dialog__meta')?.textContent ?? '';
    expect(meta).toBe('09:12 开始，18:40 关闭');
    expect(container.textContent).toContain('写周报 · 已计时 04:12:30');
  });

  it('三元素记账：复选框 0 命中，只有 2 个主按钮 + 1 个文字动作，且每个选项带数字', async () => {
    await mount(RUNNING_SESSION);
    expect(container.querySelectorAll('input[type="checkbox"]')).toHaveLength(0);
    expect(texts()).toEqual([
      '一直算到现在（05:32:30）',
      '结束在 18:40（04:12:30）',
      '丢弃这段',
    ]);
  });

  it('选项 B：endAt = 关闭时间（runningSince），不是 now；不并入空档', async () => {
    await mount(RUNNING_SESSION);
    await act(async () => {
      buttonByText('结束在')?.click();
    });
    expect(lastCall()).toEqual({ action: 'close', includeGap: false, endAt: CLOSE_AT });
  });

  it('选项 A：resume + includeGap（空档并入后继续计时），不带 endAt', async () => {
    await mount(RUNNING_SESSION);
    await act(async () => {
      buttonByText('一直算到现在')?.click();
    });
    expect(lastCall()).toEqual({ action: 'resume', includeGap: true, endAt: undefined });
  });

  it('丢弃这段：discard，不带 gap 也不带 endAt', async () => {
    await mount(RUNNING_SESSION);
    await act(async () => {
      buttonByText('丢弃这段')?.click();
    });
    expect(lastCall()).toEqual({ action: 'discard', includeGap: false, endAt: undefined });
  });

  it('H6：Esc 执行次按钮（结束在关闭时间），不再继续计时', async () => {
    await mount(RUNNING_SESSION);
    const dialog = container.querySelector('.dialog');
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(lastCall()).toEqual({ action: 'close', includeGap: false, endAt: CLOSE_AT });
  });

  it('点遮罩不关闭：对话框仍在，没有发起任何解析', async () => {
    await mount(RUNNING_SESSION);
    await act(async () => {
      container
        .querySelector('.dialog-scrim')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    });
    expect(container.querySelector('.dialog')).not.toBeNull();
    expect(CALLS).toHaveLength(0);
  });
});

describe('RecoverDialog —— 暂停中崩溃（单按钮分支，H4）', () => {
  beforeEach(() => {
    vi.spyOn(Date, 'now').mockReturnValue(NOW);
    CALLS.length = 0;
    useItemStore.setState({ items: [ITEM] });
    useUiStore.setState({ recover: PAUSED_SESSION, notice: null });
  });

  afterEach(async () => {
    await act(async () => {
      root?.unmount();
    });
    container?.remove();
    vi.restoreAllMocks();
  });

  it('H4：只有「结束并保存」一个按钮；元信息逐字「09:12 开始，已暂停」；没有关闭时刻', async () => {
    await mount(PAUSED_SESSION);
    expect(texts()).toEqual(['结束并保存（04:12:30）', '丢弃这段']);
    expect(container.querySelector('.dialog__meta')?.textContent).toBe('09:12 开始，已暂停');
    expect(container.textContent).not.toContain('关闭');
    expect(container.textContent).not.toContain('一直算到现在');
  });

  it('暂停分支的 Esc：close 不带 endAt（不编造关闭时刻）', async () => {
    await mount(PAUSED_SESSION);
    const dialog = container.querySelector('.dialog');
    await act(async () => {
      dialog?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(lastCall()).toEqual({ action: 'close', includeGap: false, endAt: undefined });
  });
});
