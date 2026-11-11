/**
 * `{overview:true}` 落点的形状与消费（P1-02 E4 · 跨语言契约）
 * -----------------------------------------------------------------------------
 * 从主文件 `mainToolsNavigationGateway.test.ts` 拆出来：那里已 291 行、距 300 行硬上限只剩
 * 9 行，再塞 3 条就会顶格（TD-02 的翻版）。这里只放 overview 这一支：
 *  · 形状：必须与 Rust `MainWindowTargetDto`（`commands/insight/window_cmd.rs`）逐字对齐；
 *  · 判序：`history` 与 `overview` 并存时落 history（与 `PatinaOpenTarget::into_view()` 同一条）；
 *  · 消费：`take` 到 overview 后只允许 `navigate("dashboard")`，不许顺手注入状态。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { invokeMock, doorbell } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  doorbell: { ring: null as null | (() => void) },
}));

vi.mock('@tauri-apps/api/core', () => ({ invoke: invokeMock }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(async (_event: string, handler: () => void) => {
    doorbell.ring = handler;
    return () => { doorbell.ring = null; };
  }),
}));

import { takeMainToolsTarget } from './mainToolsNavigationGateway.ts';
import {
  useMainToolsNavigation,
  type HistoryDateRequest,
  type MainToolsNavigationDeps,
} from '../../app/hooks/useMainToolsNavigation.ts';

/** 让下一次 `take` 拿到这份载荷（模拟 Rust 命令的返回值）。 */
function respondWith(payload: unknown): void {
  invokeMock.mockResolvedValueOnce(payload);
}

describe('takeMainToolsTarget —— overview 分支', () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it('p102_overview_branch_matches_the_rust_serialization', async () => {
    /* Rust 只从 `PendingView::Overview` 发 `{ "overview": true }`。`false` / 字符串 / 数字
       一律判非法——放行 `false` 等于给「总览被取消」造一个并不存在的语义。 */
    respondWith({ overview: true });
    await expect(takeMainToolsTarget()).resolves.toEqual({ kind: 'overview' });

    for (const payload of [{ overview: false }, { overview: 'true' }, { overview: 1 }]) {
      respondWith(payload);
      await expect(takeMainToolsTarget(), `${JSON.stringify(payload)} 应抛错`).rejects.toThrow(
        'Invalid main window target',
      );
    }
  });

  it('p102_history_wins_over_overview_when_both_keys_are_present', async () => {
    /* 与 Rust `PatinaOpenTarget::into_view()` 同一条判序（FUSION-ARCH-P1-v1 §5.3）：
       history 带着「具体某一天 + 聚焦应用」，信息更多；并存时落 history 才不丢日期。 */
    respondWith({ overview: true, history: { dateKey: '2026-11-10', focusApp: null } });
    await expect(takeMainToolsTarget()).resolves.toEqual({
      kind: 'history', dateKey: '2026-11-10', focusApp: null,
    });
  });
});

describe('overview 落点的消费（P1-02 判据④）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    invokeMock.mockReset();
    doorbell.ring = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  /** 放完 effect 里那串「订阅 → take → navigate」的微任务。 */
  async function flush(times = 6): Promise<void> {
    await act(async () => {
      for (let i = 0; i < times; i += 1) await Promise.resolve();
    });
  }

  /** 最小宿主：只挂 hook；`setHistoryDateRequest` 用真状态模拟 dispatch。 */
  function mount(options: { navigated?: boolean } = {}) {
    const state = { request: null as HistoryDateRequest | null };
    const navigate = vi.fn(async () => ({ navigated: options.navigated ?? true }));
    const setHistoryDateRequest = vi.fn((update: unknown) => {
      state.request = (typeof update === 'function'
        ? (update as (current: HistoryDateRequest | null) => HistoryDateRequest | null)(state.request)
        : update) as HistoryDateRequest | null;
    });
    const setToolsInitialTarget = vi.fn();
    const deps = {
      navigate,
      setToolsInitialTarget,
      setHistoryDateRequest,
    } as unknown as MainToolsNavigationDeps;

    act(() => {
      root.render(createElement(function Host() {
        useMainToolsNavigation(deps);
        return null;
      }));
    });
    return { state, navigate, setToolsInitialTarget };
  }

  it('p102_overview_target_switches_to_dashboard_and_sets_nothing_else', async () => {
    /* `{overview:true}` 只能变成 `navigate('dashboard')`，不许顺手注入状态（不碰
       historyDateRequest、不碰 toolsInitialTarget）；取消导航时同样什么都不留。 */
    respondWith({ overview: true });
    const { state, navigate, setToolsInitialTarget } = mount();
    await flush();
    expect(navigate).toHaveBeenCalledWith('dashboard');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state.request).toBeNull();
    expect(setToolsInitialTarget).not.toHaveBeenCalled();

    respondWith({ overview: true });
    const cancelled = mount({ navigated: false });
    await flush();
    expect(cancelled.navigate).toHaveBeenCalledWith('dashboard');
    expect(cancelled.state.request).toBeNull();
  });
});
