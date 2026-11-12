/**
 * `{settings:true}` 落点的**消费**（[0.12.1] 两窗收口）
 * -----------------------------------------------------------------------------
 * 形状与判序钉在主文件 `mainToolsNavigationGateway.test.ts`（`t03_*` 两条），这里只放
 * 「落到视图」这一段——从主文件拆出来的原因与 overview 那支相同：主文件已 286 行、距 300 行
 * 硬上限只剩 14 行，再塞一个挂载宿主就会顶格。
 *
 * 为什么非要单独钉：独立设置窗下线后，「托盘『设置…』/ 药丸手柄 `settings.open` 能落到设置页」
 * 整条链只剩一句 `else if (target.kind === "settings") await openSettings();`。删掉它、把
 * settings 误并进 overview 分支、或顺手写成 `navigate("dashboard")`，全仓没有任何判据会红，
 * 症状是「菜单项点了没反应」——没有报错、没有日志。
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

import {
  useMainToolsNavigation,
  type HistoryDateRequest,
  type MainToolsNavigationDeps,
} from '../../shell/hooks/useMainToolsNavigation.ts';

/** 让下一次 `take` 拿到这份载荷（模拟 Rust 命令的返回值）。 */
function respondWith(payload: unknown): void {
  invokeMock.mockResolvedValueOnce(payload);
}

describe('settings 落点的消费（[0.12.1]）', () => {
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

  /** 放完 effect 里那串「订阅 → take → navigate → set」的微任务。 */
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

  it('t03_settings_target_switches_to_the_settings_view_and_sets_nothing_else', async () => {
    /* 冷启动路径（挂载即 take）：只允许 `navigate('settings')` 一次；设置页不消费
       `historyDateRequest` / `toolsInitialTarget`，顺手清或顺手设都是多余的副作用。 */
    respondWith({ settings: true });
    const { state, navigate, setToolsInitialTarget } = mount();
    await flush();

    expect(navigate).toHaveBeenCalledWith('settings');
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(state.request).toBeNull();
    expect(setToolsInitialTarget).not.toHaveBeenCalled();
  });

  it('t03_settings_doorbell_repeats_and_cancelled_navigation_leaves_nothing', async () => {
    /* 热路径：门铃只是「有新的 pending」通知，不带载荷，摇一次再 take 一次。托盘连点两次
       「设置…」就得切两次（不像 history 需要 requestId 去重——视图跳转本身幂等）。
       被未保存改动确认拦住（`navigated: false`）时不重试、不留状态。 */
    respondWith({ settings: true });
    const { navigate } = mount();
    await flush();

    respondWith({ settings: true });
    act(() => doorbell.ring?.());
    await flush();
    expect(navigate).toHaveBeenCalledTimes(2);

    respondWith({ settings: true });
    const cancelled = mount({ navigated: false });
    await flush();
    expect(cancelled.navigate).toHaveBeenCalledWith('settings');
    expect(cancelled.state.request).toBeNull();
    expect(cancelled.setToolsInitialTarget).not.toHaveBeenCalled();
  });
});
