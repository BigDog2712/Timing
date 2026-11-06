/**
 * Timing — 跨窗事项刷新 hook 的信号覆盖（V0.11.7 · QA 补测）
 * -----------------------------------------------------------------------------
 * 工程师的回归用例（`TodosWindow.focusRefresh.test.tsx`）只走了 `window focus` 一条路。
 * 但 `useItemsRefreshOnFocus` 并联了**两个**信号，`ADR-052` 与 hook 注释都把
 * `document visibilitychange` 写成「任一条不灵时另一条兜底」的主路径之一——
 * 也就是说这条兜底如果坏掉，现有用例一条都不会红。本文件补上：
 *
 *   1. `visibilitychange` 转 visible → 重拉（**变更点**：engineer 未覆盖）；
 *   2. `visibilitychange` 转 hidden → **不**重拉（hook 里的守卫，白跑一次查询的代价）；
 *   3. 卸载后事件不再触发重拉（监听器泄漏 = 每次切窗多打一次查询）。
 *
 * 直接测 hook 本身，不挂在 `TodosWindow` 上：那条路径已有别的用例覆盖，
 * 这里只想钉死「信号 → reload」这一层，避免把面板渲染的噪声带进来。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useItemsRefreshOnFocus } from './useItemsRefreshOnFocus';

const { reload } = vi.hoisted(() => ({ reload: vi.fn(async () => []) }));

/* hook 只用到 `useItemStore.getState().reload()`，不必造整个 store。 */
vi.mock('../stores/itemStore', () => ({
  useItemStore: { getState: () => ({ reload }) },
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
/** jsdom 的 `document.visibilityState` 恒为 'visible'，用可改的 getter 覆盖来模拟切后台 */
let visibility: DocumentVisibilityState;

function Probe() {
  useItemsRefreshOnFocus();
  return null;
}

/** 让 `reload()` 这个微任务跑完；hook 里是 `void reload().catch(...)`，不等 Promise */
const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
  Object.defineProperty(document, 'hidden', {
    configurable: true,
    get: () => visibility === 'hidden',
  });
  act(() => {
    root.render(<Probe />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  /* 覆盖上去的 getter 必须撤掉：jsdom 的实例在文件间共享时会把假状态漏给别的用例 */
  Reflect.deleteProperty(document, 'visibilityState');
  Reflect.deleteProperty(document, 'hidden');
  reload.mockClear();
});

describe('useItemsRefreshOnFocus — 两个信号都必须能重拉', () => {
  it('visibilitychange 转 visible → 重拉一次', async () => {
    visibility = 'visible';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('visibilitychange 转 hidden → 不重拉（守卫生效，不白跑查询）', async () => {
    visibility = 'hidden';
    await act(async () => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });

  it('window focus 同样能重拉（主路径，与上面并联）', async () => {
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
    });
    await flush();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('卸载后 focus / visibilitychange 都不再重拉（无监听器泄漏）', async () => {
    act(() => {
      root.unmount();
    });
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await flush();
    expect(reload).not.toHaveBeenCalled();
  });
});
