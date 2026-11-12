/**
 * 摘要面板页脚的「在分析窗看总览」（P1-02 E4）
 * -----------------------------------------------------------------------------
 * 判据③：点它必须发出 `{ target: { overview: true } }`——这份 JSON 直接对应 Rust
 * `PatinaOpenTarget`（`deny_unknown_fields` + camelCase），多一个键少一个键都会被宿主拒收，
 * 而症状只是「窗开了但停在默认页」，没有报错。这是**冷启动**也成立的那条互链
 * （宿主先写 pending 再 show，见 `src/services/mainToolsPendingOrder.source.test.ts`）。
 *
 * 取数一律 mock：本用例只关心页脚那个按钮点了会发出什么。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { openPatinaWindowMock } = vi.hoisted(() => ({ openPatinaWindowMock: vi.fn() }));

vi.mock('../../hooks/useTodayRecords', () => ({
  useTodayRecords: () => ({ rows: [], loading: false, error: null, reload: vi.fn() }),
}));
vi.mock('../../hooks/useTimerTick', () => ({ useTimerTick: () => 0 }));
vi.mock('../../hooks/useTimerActions', () => ({
  useTimerActions: () => ({ start: vi.fn(), togglePause: vi.fn(), switchTo: vi.fn() }),
}));
vi.mock('../../services/dailyStatusActions', () => ({
  getDailyDigestStatuses: vi.fn(async () => ({})),
  setDailyDigestStatus: vi.fn(async () => undefined),
}));
vi.mock('../../services/api', () => ({ recordApi: { remove: vi.fn() } }));
vi.mock('../../services/ipc', () => ({
  errorText: (error: unknown) => String(error),
  ipc: { openPatinaWindow: openPatinaWindowMock },
}));

import { TodayDigest } from './TodayDigest.tsx';

describe('TodayDigest 页脚的「在分析窗看总览」（P1-02 E4）', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    openPatinaWindowMock.mockReset();
    openPatinaWindowMock.mockResolvedValue(undefined);
    /* 挂载会把「事项状态」的 Promise 放完（`:45` 的 effect），必须在 act 里等它落地，
       否则状态更新跑到 act 外面，jsdom 会报 "not wrapped in act"。 */
    await act(async () => {
      root.render(createElement(TodayDigest, { onClose: vi.fn(), onViewRecords: vi.fn() }));
      for (let i = 0; i < 4; i += 1) await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function footerButton(text: string): HTMLButtonElement {
    const found = [...container.querySelectorAll('footer button')].find((element) =>
      (element.textContent ?? '').includes(text));
    if (!found) throw new Error(`页脚找不到按钮：${text}`);
    return found as HTMLButtonElement;
  }

  it('p102_overview_entry_sends_the_rust_patina_open_target_shape', async () => {
    await act(async () => {
      footerButton('在分析窗看总览').click();
      await Promise.resolve();
    });
    expect(openPatinaWindowMock).toHaveBeenCalledTimes(1);
    /* 精确对象断言：变异成 `{ target: { history: { … } } }` → 本用例红 */
    expect(openPatinaWindowMock).toHaveBeenCalledWith({ target: { overview: true } });
  });

  it('p102_the_existing_footer_actions_are_untouched', () => {
    expect(footerButton('查看今日计时')).toBeTruthy();
    expect(footerButton('关闭')).toBeTruthy();
  });
});
