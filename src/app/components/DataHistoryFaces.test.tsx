import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DataHistoryFaces, { type DataFace } from './DataHistoryFaces.tsx';

/**
 * 「数据 / 历史 一个页面两副面孔」的接线判据（[0.12.1 末]）。
 *
 * 这个容器最容易犯的错不是长相，而是**接线**：
 *   ① 两面同时挂载 —— 数据和历史各自拉全套快照（历史单日那套 60+ 个 hook），
 *      一进页面就把同一批库查两遍，肉眼只表现为"打开有点慢"；
 *   ② 面签点了不导航（忘了接 `onSelect`），或高亮不跟 `active` 走 ——
 *      症状是"点了没反应"或"面签亮着概览、内容是历史"。
 * 三者都不会报错，所以只能靠这里钉住。
 */
const onSelect = vi.fn();

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

function render(active: DataFace): void {
  act(() => {
    root.render(createElement(DataHistoryFaces, {
      active,
      labels: { data: '数据', history: '历史' },
      onSelect,
      dataNode: createElement('p', { 'data-node': 'data' }, '概览内容'),
      historyNode: createElement('p', { 'data-node': 'history' }, '历史内容'),
    }));
  });
}

function tabs(): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>('[role="tab"]'));
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  onSelect.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('DataHistoryFaces · 一个页面两副面孔', () => {
  it('f01_only_the_active_face_is_mounted', () => {
    render('data');
    expect(container.querySelector('[data-node="data"]')?.textContent).toBe('概览内容');
    /* 反向断言：历史面**不许**跟着挂载（否则两套 hook 同时跑） */
    expect(container.querySelector('[data-node="history"]')).toBeNull();
  });

  it('f02_history_face_mounts_alone', () => {
    render('history');
    expect(container.querySelector('[data-node="history"]')?.textContent).toBe('历史内容');
    expect(container.querySelector('[data-node="data"]')).toBeNull();
  });

  it('f03_clicking_a_tab_asks_the_shell_to_navigate', () => {
    render('data');
    const [dataTab, historyTab] = tabs();
    act(() => historyTab.click());
    expect(onSelect).toHaveBeenCalledWith('history');
    act(() => dataTab.click());
    expect(onSelect).toHaveBeenLastCalledWith('data');
  });

  it('f04_selection_follows_the_active_face', () => {
    render('history');
    const [dataTab, historyTab] = tabs();
    expect(dataTab.getAttribute('aria-selected')).toBe('false');
    expect(historyTab.getAttribute('aria-selected')).toBe('true');
    /* tablist 要有读屏名，且两个面名都在里面 */
    const list = container.querySelector('[role="tablist"]');
    expect(list?.getAttribute('aria-label')).toContain('数据');
    expect(list?.getAttribute('aria-label')).toContain('历史');
  });
});
