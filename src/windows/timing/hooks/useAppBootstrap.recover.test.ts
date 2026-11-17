import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TimerState } from '../types/domain';

const h = vi.hoisted(() => ({
  refresh: vi.fn(),
  reload: vi.fn(async () => undefined),
  reloadReference: vi.fn(async () => null),
  setRecover: vi.fn(),
  setNotice: vi.fn(),
  resolveOpenRecord: vi.fn(async () => undefined),
  initTheme: vi.fn(async () => undefined),
}));

vi.mock('./useTauriEvent', () => ({ useTauriEvent: vi.fn() }));
vi.mock('../lib/platform', () => ({ IS_MOBILE: true }));
vi.mock('../services/ipc', () => ({ ipc: { resolveOpenRecord: h.resolveOpenRecord } }));
vi.mock('../services/themeActions', () => ({ themeActions: { init: h.initTheme } }));
vi.mock('../stores/timerStore', () => ({ useTimerStore: { getState: () => ({ refresh: h.refresh }) } }));
vi.mock('../stores/itemStore', () => ({ useItemStore: { getState: () => ({ reload: h.reload }) } }));
vi.mock('../stores/settingsStore', () => ({
  useSettingsStore: { getState: () => ({ reload: h.reload, reloadReference: h.reloadReference }) },
}));
vi.mock('../stores/uiStore', () => ({
  useUiStore: { getState: () => ({ setRecover: h.setRecover, setNotice: h.setNotice }) },
}));

const { useAppBootstrap } = await import('./useAppBootstrap');
(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function Harness() {
  useAppBootstrap();
  return null;
}

function state(accumulatedSec: number, runningSince: number | null): TimerState {
  return {
    status: runningSince === null ? 'paused' : 'running',
    session: {
      id: 1, itemId: 1, status: 'active', startedAt: 1_000, endedAt: null,
      accumulatedSec, runningSince, note: null, mode: 'countup', targetSec: null,
    },
    lastItemId: 1, liveDurationSec: accumulatedSec, mode: 'countup', remainingSec: null,
  };
}

let container: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  vi.clearAllMocks();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container.remove();
});

async function mount() {
  await act(async () => { root?.render(createElement(Harness)); });
}

describe('启动恢复保留用户记录', () => {
  it.each([0, 5, 30, 45, 59, 60, 300])('暂停的 %i 秒会话由用户决定，不自动删除', async (seconds) => {
    const previous = state(seconds, null);
    h.refresh.mockResolvedValue(previous);
    await mount();
    expect(h.setRecover).toHaveBeenCalledExactlyOnceWith(previous.session);
    expect(h.resolveOpenRecord).not.toHaveBeenCalled();
  });

  it('尚未周期落盘的运行会话也不能按累计零秒删除', async () => {
    const previous = state(0, 1_000);
    h.refresh.mockResolvedValue(previous);
    await mount();
    expect(h.setRecover).toHaveBeenCalledExactlyOnceWith(previous.session);
    expect(h.resolveOpenRecord).not.toHaveBeenCalled();
  });

  it('没有未结束会话时不显示恢复弹层', async () => {
    h.refresh.mockResolvedValue({ ...state(0, null), status: 'idle', session: null });
    await mount();
    expect(h.setRecover).not.toHaveBeenCalled();
    expect(h.resolveOpenRecord).not.toHaveBeenCalled();
  });

  it('初始化失败不尝试删除会话，仍初始化主题', async () => {
    h.refresh.mockRejectedValueOnce(new Error('database unavailable'));
    await mount();
    expect(h.resolveOpenRecord).not.toHaveBeenCalled();
    expect(h.setRecover).not.toHaveBeenCalled();
    expect(h.setNotice).toHaveBeenCalledWith({ text: '初始化失败，请稍后重试', tone: 'danger' });
    expect(h.initTheme).toHaveBeenCalled();
  });

  it('卸载后的加载结果不会弹出恢复界面', async () => {
    let resolve!: (value: TimerState) => void;
    h.refresh.mockReturnValueOnce(new Promise<TimerState>((done) => { resolve = done; }));
    await mount();
    act(() => root?.unmount());
    root = null;
    await act(async () => { resolve(state(45, null)); });
    expect(h.setRecover).not.toHaveBeenCalled();
    expect(h.resolveOpenRecord).not.toHaveBeenCalled();
  });
});
