/**
 * Timing — 键盘分派单测（V0.3.8：Space 的暂停方向必须触发 onPause 连招）
 * -----------------------------------------------------------------------------
 * 用 `createRoot` + `act`（禁 renderToStaticMarkup，理由见 MainButton.test.tsx）。
 * 断言的是**分派契约**：暂停方向（running + Space）交给 onPause（含 togglePause + 弹菜单），
 * 继续 / 开始方向仍走裸 togglePause，且长按 repeat 不重复触发。
 */
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { usePillKeyboard } from './usePillKeyboard';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

interface Harness {
  press: (key: string, repeat?: boolean) => void;
  togglePause: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
}

function mount(status: string, onPause?: () => void): Harness {
  const togglePause = vi.fn();
  const stop = vi.fn();
  function Probe() {
    const onKeyDown = usePillKeyboard(status, { togglePause, stop }, onPause);
    return (
      <div onKeyDown={onKeyDown}>
        <button type="button" className="ring" />
      </div>
    );
  }
  act(() => {
    root.render(<Probe />);
  });
  return {
    press: (key: string, repeat = false) => {
      const ring = container.querySelector<HTMLElement>('.ring');
      if (!ring) throw new Error('未渲染 .ring');
      act(() => {
        ring.dispatchEvent(new KeyboardEvent('keydown', { key, repeat, bubbles: true }));
      });
    },
    togglePause,
    stop,
  };
}

describe('Space（焦点在圆环上）', () => {
  it('running → 暂停方向：onPause 触发、裸 togglePause 不直接调用', () => {
    const onPause = vi.fn();
    const h = mount('running', onPause);
    h.press(' ');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(h.togglePause).not.toHaveBeenCalled();
  });

  it('paused → 继续方向：同样交给 onPause（连招内部收掉摸鱼菜单），不裸调 togglePause', () => {
    const onPause = vi.fn();
    const h = mount('paused', onPause);
    h.press(' ');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(h.togglePause).not.toHaveBeenCalled();
  });

  it('idle → 开始方向：也交给 onPause（hook 内对该方向不弹不收）', () => {
    const onPause = vi.fn();
    const h = mount('idle', onPause);
    h.press(' ');
    expect(onPause).toHaveBeenCalledTimes(1);
    expect(h.togglePause).not.toHaveBeenCalled();
  });

  it('长按 repeat 不重复触发（连按保护不回退）', () => {
    const onPause = vi.fn();
    const h = mount('running', onPause);
    h.press(' ', true);
    h.press(' ', true);
    expect(onPause).not.toHaveBeenCalled();
  });

  it('未传 onPause 时退回裸 togglePause（可选参数向后兼容）', () => {
    const h = mount('running');
    h.press(' ');
    expect(h.togglePause).toHaveBeenCalledTimes(1);
  });
});

describe('Enter / 焦点不在圆环（回归）', () => {
  it('paused + Enter → stop 一次', () => {
    const h = mount('paused');
    h.press('Enter');
    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.togglePause).not.toHaveBeenCalled();
  });

  it('idle + Enter → 不 stop（空闲无计时可结束）', () => {
    const h = mount('idle');
    h.press('Enter');
    expect(h.stop).not.toHaveBeenCalled();
  });
});
