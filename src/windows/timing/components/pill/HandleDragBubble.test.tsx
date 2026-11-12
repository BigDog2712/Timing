/**
 * 手柄「按住拖窗口」的源码级判据（设计 §5.3 / G-06）—— [0.12.1] QA 补测
 * -----------------------------------------------------------------------------
 * 为什么单开一份：`HandleCluster.test.tsx` 覆盖了顺序/形状/键盘/槽位语义，但**没有**一条
 * 盯住「`pointerdown(0)` 必须继续冒泡」。而这一条正是本轮最容易悄悄弄坏、症状又最难查的：
 * 手柄一旦对左键 `stopPropagation`，`.pill` 的 `usePillDrag` 收不到按下点，
 * 用户抓着右手柄拖窗口就变成「拖不动」（而且没有任何报错）。
 *
 * 为什么不能端到端测（合成 pointerdown → startCurrentWindowDrag）：
 * `usePillDrag.onDown` 第一行是 `if (!e.isTrusted || e.button !== 0) return;`，
 * jsdom 里 `dispatchEvent` 造的 PointerEvent 恒为 `isTrusted === false`，
 * 所以「拖起来」这条路只能在真机上验。这里退一格，测**事件是否逃出按钮**：
 * 在祖先上挂一个监听，`pointerdown(0)` 到达祖先 = 不会被 `.pill` 漏掉；
 * `pointerdown(1|2)` 到达祖先 = 中键/右键会被别处（拖动判定、menubar）误接。
 *
 * 反证：把 `HandleButton` 的 `onPointerDown` 改成对 button 0 也 `stopPropagation()`，
 * 第一条当场红。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_HANDLE_BINDINGS } from '../../lib/handleCatalog';
import type { HandleActionCtx } from '../../services/handleActions/guards';
import { HandleCluster } from './HandleCluster';

type Ctx = Omit<HandleActionCtx, 'anchor'>;

function makeCtx(): Ctx {
  return {
    status: 'idle',
    itemId: null,
    timer: {
      start: vi.fn(), togglePause: vi.fn(), stop: vi.fn(), undo: vi.fn(),
      switchTo: vi.fn(), startOrSwitch: vi.fn(), discardCurrent: vi.fn(), resolveRecover: vi.fn(),
    },
    ui: {
      openPanel: vi.fn(),
      openNotesList: vi.fn(),
      openCountdownMenu: vi.fn(),
      openMoyuMenu: vi.fn(),
    },
    notice: vi.fn(),
  };
}

let container: HTMLDivElement;
let root: Root;
let ancestorDown: ReturnType<typeof vi.fn>;

/** 祖先（= `.pill` 的替身）只做一件事：数一数 `pointerdown` 有没有到这里 */
function Harness() {
  return createElement(
    'div',
    { onPointerDown: ancestorDown },
    createElement(HandleCluster, { bindings: DEFAULT_HANDLE_BINDINGS, baseCtx: makeCtx() }),
  );
}

function fullHandle(): HTMLElement {
  const el = container.querySelector<HTMLElement>('[data-handle="full"]');
  if (!el) throw new Error('没渲染出 full 手柄');
  return el;
}

function pointerDown(element: HTMLElement, button: number): PointerEvent {
  const event = new PointerEvent('pointerdown', { bubbles: true, cancelable: true, button });
  act(() => { element.dispatchEvent(event); });
  return event;
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  ancestorDown = vi.fn();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => { root.render(createElement(Harness)); });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('G-06：三种按钮各自该不该冒泡', () => {
  it('b01_left_pointerdown_reaches_the_pill_so_dragging_still_works', () => {
    /* 本轮最重要的一条：左键按下必须冒泡给 `.pill`（usePillDrag 在那里拿按下点）。
       变异：在 onPointerDown 里对 button 0 也 stopPropagation() → 本条红。 */
    const event = pointerDown(fullHandle(), 0);
    expect(ancestorDown).toHaveBeenCalledTimes(1);
    /* 左键不许被 preventDefault：那会连带吃掉 click 的默认焦点行为 */
    expect(event.defaultPrevented).toBe(false);
  });

  it('b02_middle_pointerdown_is_swallowed_and_default_prevented', () => {
    /* 中键：抑制 WebView2 自动滚动（G-05），且**不许**冒泡到拖动判定 */
    const event = pointerDown(fullHandle(), 1);
    expect(ancestorDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('b03_right_pointerdown_is_swallowed_but_not_default_prevented', () => {
    /* 右键：只 stopPropagation（否则上下文菜单会被别处的手势抢走）。
       不 preventDefault —— 右键的默认行为由 onContextMenu 里单独拦，两处只拦一次。 */
    const event = pointerDown(fullHandle(), 2);
    expect(ancestorDown).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('b04_a_disabled_handle_cannot_start_a_drag', () => {
    /* 关掉的手柄由 CSS `display:none` 隐藏；这里只钉住「它不会因为排在 DOM 里就抢事件」：
       dot/half 默认关，点它们仍然会冒泡（它们不可见，命中测试根本不会落在上面）。 */
    const dot = container.querySelector<HTMLElement>('[data-handle="dot"]');
    if (!dot) throw new Error('关掉的手柄应当仍在 DOM 里（H-02 的判据依赖这一点）');
    expect(dot.getAttribute('data-enabled')).toBe('false');
    pointerDown(dot, 0);
    expect(ancestorDown).toHaveBeenCalledTimes(1);
  });
});
