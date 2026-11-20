/**
 * Timing — 内联命名 InlineNameEntry 的失焦判据（0.13.x）
 * -----------------------------------------------------------------------------
 * 药丸新建事项时，框底同时展开常用框（标签 / 应用 /「开始」）。焦点从条上的输入框
 * 挪到菜单里的按钮**不是放弃**——旧实现 blur 即取消，点一下「AI」草稿就没了。
 * 这里钉住新口径：
 *   ① 焦点落进 `.menu` 里 → 不取消；
 *   ② 焦点回 body（整窗失焦 / 点桌面）→ 取消；
 *   ③ 输入实时回调 onChangeText（quickAddStore 的镜像来源）。
 */
import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { InlineNameEntry } from './InlineNameEntry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let onCancel: Mock<() => void>;
let onChangeText: Mock<(value: string) => void>;

function mount(menu: boolean): void {
  const tree: ReactElement = createElement(
    'div',
    null,
    createElement(InlineNameEntry, { onSubmit: vi.fn(), onCancel, onChangeText }),
    menu ? createElement('div', { className: 'menu' }, createElement('button', { type: 'button', id: 'tag-ai' }, 'AI')) : null,
  );
  act(() => root.render(tree));
}

function input(): HTMLInputElement {
  const node = host.querySelector<HTMLInputElement>('.pill__input');
  if (!node) throw new Error('inline input missing');
  return node;
}

beforeEach(() => {
  vi.useFakeTimers();
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  onCancel = vi.fn<() => void>();
  onChangeText = vi.fn<(value: string) => void>();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
});

describe('InlineNameEntry · 失焦', () => {
  it('焦点进菜单（点标签 / 应用 / AI）不算放弃，草稿保留', () => {
    mount(true);
    act(() => {
      input().focus();
      host.querySelector<HTMLButtonElement>('#tag-ai')?.focus();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('焦点回 body（点桌面 / 整窗失焦）才取消', () => {
    mount(true);
    act(() => {
      input().focus();
      input().blur();
    });
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('输入实时镜像（onChangeText）', () => {
    mount(true);
    const node = input();
    act(() => {
      /* React 19 的受控输入靠原生 setter 更新值才会触发 onChange */
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
      setter?.call(node, '写周报');
      node.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(onChangeText).toHaveBeenCalledWith('写周报');
  });
});