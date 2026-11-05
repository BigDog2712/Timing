/**
 * Timing — 事项窗「指针离开即隐藏」单测（V0.3.9）
 * -----------------------------------------------------------------------------
 * 钉住三件事：① 真移出 → 420ms 后 hide 一次；② 指针回来 → 取消；
 * ③ **打字中**（焦点在 input 且窗口有焦点）收到 `documentElement` 的 leave 不算离开——
 * 这是「新增待办写着字，悬浮窗没了」的回归守卫（IME 候选窗会补派假 leave）。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { hideCurrentWindow } from '../lib/window';
import { useWindowLeaveHide } from './useWindowLeaveHide';

vi.mock('../lib/window', () => ({ hideCurrentWindow: vi.fn(() => Promise.resolve()) }));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const hide = vi.mocked(hideCurrentWindow);

let container: HTMLDivElement;
let root: Root;
let input: HTMLInputElement;

function Probe() {
  useWindowLeaveHide();
  return <input aria-label="新增待办" />;
}

const fire = (type: 'pointerleave' | 'pointerenter') =>
  document.documentElement.dispatchEvent(new Event(type));

const flush = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(document, 'hasFocus').mockReturnValue(true);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  act(() => {
    root.render(<Probe />);
  });
  input = container.querySelector('input') as HTMLInputElement;
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

describe('useWindowLeaveHide', () => {
  it('指针移出窗口 → 420ms 后隐藏一次', () => {
    act(() => fire('pointerenter'));
    act(() => fire('pointerleave'));
    flush(419);
    expect(hide).not.toHaveBeenCalled();
    flush(1);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('宽限期内指针回来 → 不再隐藏', () => {
    act(() => fire('pointerenter'));
    act(() => fire('pointerleave'));
    flush(200);
    act(() => fire('pointerenter'));
    flush(600);
    expect(hide).not.toHaveBeenCalled();
  });

  it('还没进来过 → 显示那一刻的 leave 不算数', () => {
    act(() => fire('pointerleave'));
    flush(600);
    expect(hide).not.toHaveBeenCalled();
  });

  it('正在输入框里打字 → 假 leave 不隐藏窗口（回归守卫）', () => {
    act(() => {
      input.focus();
    });
    expect(document.activeElement).toBe(input);
    act(() => fire('pointerenter'));
    act(() => fire('pointerleave'));
    flush(1200);
    expect(hide).not.toHaveBeenCalled();
  });

  it('输入法组词期间（composition）的 leave 不算离开；组词结束后恢复', () => {
    const compose = (type: 'compositionstart' | 'compositionend') =>
      document.dispatchEvent(new Event(type, { bubbles: true }));
    act(() => fire('pointerenter'));
    act(() => compose('compositionstart'));
    act(() => fire('pointerleave'));
    flush(900);
    expect(hide).not.toHaveBeenCalled();

    act(() => compose('compositionend'));
    act(() => fire('pointerleave'));
    flush(420);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('打字但窗口已失焦 → 仍按离开处理（人已经切走了）', () => {
    act(() => {
      input.focus();
    });
    act(() => fire('pointerenter'));
    vi.spyOn(document, 'hasFocus').mockReturnValue(false);
    act(() => fire('pointerleave'));
    flush(420);
    expect(hide).toHaveBeenCalledTimes(1);
  });

  it('输入框失焦后再移出 → 恢复正常隐藏', () => {
    act(() => {
      input.focus();
    });
    act(() => fire('pointerenter'));
    act(() => fire('pointerleave'));
    flush(600);
    expect(hide).not.toHaveBeenCalled();

    act(() => {
      input.blur();
    });
    act(() => fire('pointerleave'));
    flush(420);
    expect(hide).toHaveBeenCalledTimes(1);
  });
});
