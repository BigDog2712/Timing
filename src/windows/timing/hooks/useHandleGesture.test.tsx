/**
 * 手柄手势的单测（§5.2 判定表 #1–#11）
 * -----------------------------------------------------------------------------
 * 每一条都是「一次物理动作 → 恰好一个槽」。最容易错的两类：① 双击序列里第一击的 250ms
 * 定时器没被取消 → 一次双击派发两个动作（G-02）；② 右键 / 中键挂在错的事件上 → 一次
 * 物理右键派发两次、或中键被 WebView2 吞掉。用例名带 `h10_` / `h11_` 前缀，变异自证直接点名。
 * 手法：探针 `<button>` 挂 8 个 handler，派发**真实 DOM 事件**（jsdom 有 PointerEvent）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Mock } from 'vitest';

import type { HandleSlot } from '../lib/handleCatalog';
import { DBLCLICK_MS } from '../lib/constants';
import { useHandleGesture } from './useHandleGesture';

type Slots = Record<HandleSlot, string | null>;

/** 双击槽全空：单击必须当帧派发（0 延迟） */
const NO_DOUBLE: Slots = {
  left: 'note.current', right: 'note.list', middle: 'patina.open', leftDouble: null, rightDouble: null,
};

/** 双击槽有值（= full 的默认绑定）：单击要等一个判定窗 */
const WITH_DOUBLE: Slots = {
  left: 'note.current', right: 'note.list', middle: 'patina.open',
  leftDouble: 'today.panel', rightDouble: 'today.digest',
};

function Probe({ slots, fire }: { slots: Slots; fire: (slot: HandleSlot) => void }) {
  const gesture = useHandleGesture({ slots, fire });
  return <button type="button" {...gesture} />;
}

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;
let fire: Mock<(slot: HandleSlot) => void>;

function mount(slots: Slots): void {
  act(() => {
    root.render(createElement(Probe, { slots, fire }));
  });
}

/** 卸载一次即置位：用例可能自己先卸载（验证"卸载清定时器"），afterEach 不能再拆一遍 */
function unmount(): void {
  if (!mounted) return;
  mounted = false;
  act(() => root.unmount());
}

function button(): HTMLButtonElement {
  const el = container.querySelector('button');
  if (!el) throw new Error('探针按钮没渲染出来');
  return el;
}

function click(detail: number): void {
  act(() => {
    button().dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, detail }));
  });
}

type PointerKind = 'pointerdown' | 'pointerup' | 'pointermove' | 'pointercancel';

function pointer(type: PointerKind, init: PointerEventInit = {}): PointerEvent {
  const event = new PointerEvent(type, { bubbles: true, cancelable: true, ...init });
  act(() => {
    button().dispatchEvent(event);
  });
  return event;
}

function mouse(type: 'contextmenu' | 'auxclick' | 'mousedown', button_: number): void {
  act(() => {
    button().dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, button: button_ }));
  });
}

function advance(ms: number): void {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  fire = vi.fn<(slot: HandleSlot) => void>();
});

afterEach(() => {
  unmount();
  container.remove();
  vi.useRealTimers();
});

describe('单击：双击槽全空 → 0 延迟；有双击槽 → 等 DBLCLICK_MS', () => {
  it('h01_single_click_without_double_slots_fires_in_the_same_frame', () => {
    /* 变异：把 0 延迟改成永远等 250ms → 本条红（G-03 前半） */
    mount(NO_DOUBLE);
    click(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('left');
  });

  it('h03_single_click_with_a_double_slot_waits_the_judgement_window', () => {
    mount(WITH_DOUBLE);
    click(1);
    expect(fire).not.toHaveBeenCalled();

    advance(DBLCLICK_MS - 1);
    expect(fire).not.toHaveBeenCalled();

    advance(1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('left');
  });
});

describe('双击：配对成功只派发 *Double，单击计数必须为 0', () => {
  it('h10_double_click_fires_leftDouble_and_never_left', () => {
    /* 变异：把 leftDouble 与 left 两个实参对调 → 本组三条全红（G-02） */
    mount(WITH_DOUBLE);
    click(1);
    advance(100);
    click(2);

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('leftDouble');
    /* 第一击的定时器必须被取消：再走完整个判定窗也不许多派发一次 */
    advance(DBLCLICK_MS + 100);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('h10_right_double_fires_rightDouble', () => {
    mount(WITH_DOUBLE);
    pointer('pointerup', { button: 2 });
    advance(100);
    pointer('pointerup', { button: 2 });

    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('rightDouble');
  });

  it('h10_two_taps_further_apart_than_the_window_are_two_singles', () => {
    mount(WITH_DOUBLE);
    click(1);
    advance(DBLCLICK_MS + 1); /* 第一击已按单击派发，pendingTap 已清 */
    click(1);

    expect(fire).toHaveBeenNthCalledWith(1, 'left');
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenNthCalledWith(2, 'left');
    expect(fire).toHaveBeenCalledTimes(2);
  });
});

describe('右键：一次物理右键恰好一次派发', () => {
  it('h05_right_single_waits_then_fires_right', () => {
    mount(WITH_DOUBLE);
    pointer('pointerup', { button: 2 });
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('right');
  });

  it('h05_right_single_is_immediate_when_no_double_slot', () => {
    mount(NO_DOUBLE);
    pointer('pointerup', { button: 2 });
    expect(fire).toHaveBeenCalledWith('right');
  });

  it('h07_contextmenu_after_pointerup_does_not_double_fire', () => {
    mount(WITH_DOUBLE);
    pointer('pointerup', { button: 2 });
    mouse('contextmenu', 2);
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('right');
  });

  it('h07_contextmenu_without_pointerup_still_fires_once', () => {
    mount(WITH_DOUBLE);
    mouse('contextmenu', 2);
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('right');
  });
});

describe('中键：只在 auxclick 派发，pointerdown 只 preventDefault', () => {
  it('h08_middle_pointerdown_does_nothing', () => {
    mount(NO_DOUBLE);
    const event = pointer('pointerdown', { button: 1 });
    expect(fire).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    advance(DBLCLICK_MS);
    expect(fire).not.toHaveBeenCalled();
  });

  it('h11_auxclick_middle_fires_middle_immediately', () => {
    /* 变异：把 auxclick 与 pointerup 的处理对调 → 本条红（中键不再派发） */
    mount(WITH_DOUBLE);
    mouse('auxclick', 1);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('middle');
  });

  it('h11_auxclick_with_button_2_is_ignored', () => {
    mount(WITH_DOUBLE);
    mouse('auxclick', 2);
    expect(fire).not.toHaveBeenCalled();
  });
});

describe('键盘：detail === 0 → 立即 left，不走判定窗', () => {
  it('h06_keyboard_activation_fires_left_in_the_same_frame', () => {
    mount(WITH_DOUBLE);
    click(0);
    expect(fire).toHaveBeenCalledTimes(1);
    expect(fire).toHaveBeenCalledWith('left');
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenCalledTimes(1);
  });
});

describe('拖动互斥：越过阈值即作废本次手势', () => {
  it('h04_drag_past_threshold_voids_the_click', () => {
    mount(WITH_DOUBLE);
    pointer('pointerdown', { button: 0, buttons: 1, screenX: 100, screenY: 100 });
    pointer('pointermove', { buttons: 1, screenX: 120, screenY: 100 });
    click(1);
    advance(DBLCLICK_MS + 50);
    expect(fire).not.toHaveBeenCalled();
  });

  it('h04_move_within_threshold_keeps_the_click', () => {
    mount(WITH_DOUBLE);
    pointer('pointerdown', { button: 0, buttons: 1, screenX: 100, screenY: 100 });
    pointer('pointermove', { buttons: 1, screenX: 102, screenY: 101 });
    click(1);
    advance(DBLCLICK_MS);
    expect(fire).toHaveBeenCalledWith('left');
  });
});

describe('作废通道：卸载 / 失焦 / 指针取消都清掉待定单击', () => {
  it('h11_unmount_clears_the_pending_single', () => {
    mount(WITH_DOUBLE);
    click(1);
    unmount();
    advance(DBLCLICK_MS + 50);
    expect(fire).not.toHaveBeenCalled();
  });

  it('h11_window_blur_clears_the_pending_single', () => {
    mount(WITH_DOUBLE);
    click(1);
    act(() => {
      window.dispatchEvent(new Event('blur'));
    });
    advance(DBLCLICK_MS + 50);
    expect(fire).not.toHaveBeenCalled();
  });

  it('h11_pointercancel_clears_the_pending_single', () => {
    mount(WITH_DOUBLE);
    click(1);
    pointer('pointercancel', { button: 0 });
    advance(DBLCLICK_MS + 50);
    expect(fire).not.toHaveBeenCalled();
  });
});
