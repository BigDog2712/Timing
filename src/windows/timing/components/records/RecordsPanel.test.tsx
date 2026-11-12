/**
 * 记录面板头部的「今日摘要」（P1-02 E1）
 * -----------------------------------------------------------------------------
 * 判据①：左键「今天」→ 记录面板 → 「今日摘要」→ 摘要面板（`panel === 'digest'`）。
 * 面板里的数据源一律 mock：本用例只关心「头部那个按钮点了会怎样」，不关心后端取数
 * （取数由 `useRecordsData` / `todoPanelLists` 等各自的用例覆盖）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useRecordsData', () => ({
  useRecordsData: () => ({
    loading: false,
    error: null,
    totalSec: 0,
    recordCount: 0,
    groups: [],
    activity: [],
    reload: vi.fn(),
  }),
}));
vi.mock('../../services/api', () => ({
  recordApi: { update: vi.fn(), remove: vi.fn() },
}));
vi.mock('../../services/ipc', () => ({
  errorText: (error: unknown) => String(error),
  ipc: { openPatinaWindow: vi.fn() },
}));

import { useUiStore } from '../../stores/uiStore';
import { RecordsPanel } from './RecordsPanel.tsx';

describe('RecordsPanel 头部的「今日摘要」（P1-02 E1）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    useUiStore.setState({ panel: 'records' });
    act(() => { root.render(createElement(RecordsPanel)); });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function buttonByText(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('button')].find((element) =>
      (element.textContent ?? '').includes(text));
    if (!found) throw new Error(`找不到按钮：${text}`);
    return found as HTMLButtonElement;
  }

  it('p102_digest_button_opens_the_digest_panel', () => {
    /* 变异：把 onClick 改成 `openPanel('records')` → 本用例红 */
    act(() => { buttonByText('今日摘要').click(); });
    expect(useUiStore.getState().panel).toBe('digest');
  });

  it('p102_the_existing_analysis_entry_is_untouched', () => {
    /* V0.12/P0-03 的既有入口不许被新按钮挤掉或改名 */
    expect(buttonByText('在分析窗看这一天').className).toBe('records__analysis-entry');
  });
});
