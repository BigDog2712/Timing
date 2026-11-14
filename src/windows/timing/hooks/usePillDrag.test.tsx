/**
 * Timing — usePillDrag 拖拽口径（[0.13.x]）
 * -----------------------------------------------------------------------------
 * 为什么要这个文件：`usePillDrag` 本轮多了一句 `markDragActive()` / `markDragIdle()`
 * （给 `entry/App.tsx` 判断「托盘双击高亮能不能把圆点临时展开成条」，拖动中改窗口尺寸
 * 会打断拖动）。改别人的 hook 必须自证**既有口径一个都没变**，所以原来没有任何用例
 * 钉住的四条语义，这里全部钉上：
 *
 *   1. **4px 阈值**：位移 3px 不算拖、4px 才开拖（`DRAG_THRESHOLD_PX`）；
 *   2. **拖完吞掉那一次 click**：拖过之后紧跟的 click 被 `preventDefault` +
 *      `stopPropagation`，且**只吞一次**（下一次 click 正常放行）；
 *   3. **单击仍是单击**：按下 → 松手（位移 0）→ click 不被吞（所以圆点单击还能展开）；
 *   4. **只认可信的左键**：合成事件（`isTrusted=false`）与右键都不记起点；
 *   5. 新增的那句：越过阈值后 `isDragActive()` 为真，`onUp` 之后为假。
 *
 * 驱动方式：直接调用 hook 返回的处理器，不用 `dispatchEvent`——因为 `onDown` 第一行就是
 * `if (!e.isTrusted ...) return`，而 DOM 派发出来的事件恒为 untrusted，用真实 DOM 事件
 * 反而测不到阈值。`startCurrentWindowDrag` 被 mock 掉（Tauri 窗口拖动在 jsdom 里不存在）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';

import { usePillDrag } from './usePillDrag';
import { DRAG_CLICK_SWALLOW_MS, DRAG_THRESHOLD_PX } from '../lib/constants';
import { isDragActive, markDragIdle } from '../lib/dragState';
import { startCurrentWindowDrag } from '../lib/window';

vi.mock('../lib/window', () => ({ startCurrentWindowDrag: vi.fn(() => Promise.resolve()) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type DragApi = ReturnType<typeof usePillDrag>;

let container: HTMLDivElement;
let root: Root;
let api: DragApi | null;

/** 探针组件：把 hook 的返回值捞出来（本 hook 只有 ref，没有渲染输出） */
function Probe(): null {
  api = usePillDrag();
  return null;
}

beforeEach(() => {
  vi.useFakeTimers();
  markDragIdle();
  api = null;
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  markDragIdle();
  vi.useRealTimers();
  vi.mocked(startCurrentWindowDrag).mockClear();
});

function drag(): DragApi {
  if (!api) throw new Error('hook 未挂载');
  return api;
}

/** 可信左键的 pointer 事件（字段够 hook 用即可） */
function pointer(x: number, y: number, over: Partial<{ isTrusted: boolean; button: number }> = {}) {
  return { isTrusted: true, button: 0, screenX: x, screenY: y, ...over } as unknown as ReactPointerEvent;
}

function clickSpies() {
  return { preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('阈值：4px 才算拖', () => {
  it('位移 3px → 不算拖：不调 startCurrentWindowDrag，click 也不被吞', () => {
    drag().onDown(pointer(10, 10));
    drag().onMove(pointer(13, 13)); /* 两个方向各 3px，都 < DRAG_THRESHOLD_PX */
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
    expect(isDragActive()).toBe(false);

    const evt = clickSpies();
    drag().onClickCapture(evt as unknown as ReactMouseEvent);
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });

  it('位移正好 4px（= 阈值）→ 算拖，且只开拖一次', () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
    drag().onDown(pointer(10, 10));
    drag().onMove(pointer(14, 10));
    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
    /* 起点已清空：继续移动不会重复开拖（否则一次拖动会连开多次原生拖动） */
    drag().onMove(pointer(40, 40));
    expect(startCurrentWindowDrag).toHaveBeenCalledTimes(1);
  });
});

describe('拖完吞掉紧跟的那一次 click（且只吞一次）', () => {
  it('拖过之后第一次 click 被 preventDefault + stopPropagation', () => {
    drag().onDown(pointer(0, 0));
    drag().onMove(pointer(10, 0));
    drag().onUp();

    const swallowed = clickSpies();
    drag().onClickCapture(swallowed as unknown as ReactMouseEvent);
    expect(swallowed.preventDefault).toHaveBeenCalledTimes(1);
    expect(swallowed.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it('吞过一次之后放行：下一次 click 不再被拦（否则后续单击全失效）', () => {
    drag().onDown(pointer(0, 0));
    drag().onMove(pointer(10, 0));
    drag().onUp();
    drag().onClickCapture(clickSpies() as unknown as ReactMouseEvent);

    const next = clickSpies();
    drag().onClickCapture(next as unknown as ReactMouseEvent);
    expect(next.preventDefault).not.toHaveBeenCalled();
  });

  it('吞 click 的窗口在 DRAG_CLICK_SWALLOW_MS 后自然过期', () => {
    expect(DRAG_CLICK_SWALLOW_MS).toBe(240);
    drag().onDown(pointer(0, 0));
    drag().onMove(pointer(10, 0));
    act(() => void vi.advanceTimersByTime(DRAG_CLICK_SWALLOW_MS + 1));

    const evt = clickSpies();
    drag().onClickCapture(evt as unknown as ReactMouseEvent);
    expect(evt.preventDefault).not.toHaveBeenCalled();
  });
});

describe('单击仍是单击（圆点单击要能展开）', () => {
  it('按下 → 松手（位移 0）→ click 不被吞', () => {
    drag().onDown(pointer(5, 5));
    drag().onUp();
    const evt = clickSpies();
    drag().onClickCapture(evt as unknown as ReactMouseEvent);
    expect(evt.preventDefault).not.toHaveBeenCalled();
    expect(evt.stopPropagation).not.toHaveBeenCalled();
  });

  it('松手后再移动不产生拖动（origin 已在 onUp 里清空）', () => {
    drag().onDown(pointer(5, 5));
    drag().onUp();
    drag().onMove(pointer(50, 50));
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });
});

describe('只认可信的左键', () => {
  it('合成事件（isTrusted=false）不记起点 → 后续移动不触发拖动', () => {
    drag().onDown(pointer(0, 0, { isTrusted: false }));
    drag().onMove(pointer(50, 0));
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });

  it('右键（button=2）不记起点 → 后续移动不触发拖动', () => {
    drag().onDown(pointer(0, 0, { button: 2 }));
    drag().onMove(pointer(50, 0));
    expect(startCurrentWindowDrag).not.toHaveBeenCalled();
  });
});

describe('[0.13.x] 新增的拖拽标志：置位/复位点与 swallow 一致', () => {
  it('越过阈值 → isDragActive() 为真；onUp（松手/取消）→ 立刻为假', () => {
    expect(isDragActive()).toBe(false);
    drag().onDown(pointer(0, 0));
    drag().onMove(pointer(10, 0));
    expect(isDragActive()).toBe(true);
    drag().onUp();
    expect(isDragActive()).toBe(false);
  });

  it('没到阈值不会置位（标志语义 = 「真的在拖」，不是「按下了」）', () => {
    drag().onDown(pointer(0, 0));
    drag().onMove(pointer(2, 0));
    expect(isDragActive()).toBe(false);
  });
});
