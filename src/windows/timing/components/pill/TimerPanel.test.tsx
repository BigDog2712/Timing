/**
 * 计时小面板 TimerPanel（[B4] P2 §1.2 / A4）
 * -----------------------------------------------------------------------------
 * 这份面板存在的理由只有一条：**把「结束并保存」从本体层单击直达挪到一个带确认的按钮后面**。
 * 所以这里钉的就是这条契约：
 *   · 第一次点「结束并保存」**不许**真的结束（只是升到确认步）；
 *   · 第二次点才 `stop()`，成功后自动收起面板；
 *   · `stop()` 返回 null（被护栏挡下）时面板留着、确认步复位，让人能重试；
 *   · 不可逆语义进可访问名；Esc 关闭。
 * 把这些写成测试的理由：这条链路一旦回退，症状是「点一下就没了」，而没有任何报错。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { stopMock, closePanelMock } = vi.hoisted(() => ({
  stopMock: vi.fn(),
  closePanelMock: vi.fn(),
}));

vi.mock('../../hooks/useTimerTick', () => ({ useTimerTick: () => 190 }));
vi.mock('../../hooks/useTimerActions', () => ({
  useTimerActions: () => ({ stop: stopMock }),
}));
vi.mock('../../stores/uiStore', () => ({
  useUiStore: (selector: (s: { closePanel: () => void }) => unknown) => selector({ closePanel: closePanelMock }),
}));

import { useTimerStore } from '../../stores/timerStore';
import { useItemStore } from '../../stores/itemStore';
import { TimerPanel } from './TimerPanel.tsx';

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

function texts(): string[] {
  return [...container.querySelectorAll('button')].map((b) => (b.textContent ?? '').trim());
}

beforeEach(() => {
  stopMock.mockReset();
  closePanelMock.mockReset();
  useItemStore.setState({ items: [{ id: 7, name: '写周报', color: null } as never] });
  useTimerStore.setState({
    state: {
      status: 'running',
      session: {
        itemId: 7,
        mode: 'countup',
        targetSec: null,
        accumulatedSec: 0,
        startedAt: Date.now(),
        runningSince: Date.now(),
      } as never,
      lastItemId: 7,
    },
  } as never);
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function mount(): void {
  act(() => {
    root.render(createElement(TimerPanel));
  });
}

function click(label: string): void {
  const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === label);
  if (!btn) throw new Error(`找不到按钮：${label}（现有：${texts().join(' / ')}）`);
  act(() => {
    btn.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('TimerPanel · 结束时必须过确认', () => {
  it('第一次点只用确认步，不真的结束', () => {
    mount();
    expect(container.textContent).toContain('写周报');
    click('结束并保存');
    expect(stopMock).not.toHaveBeenCalled();
    expect(texts()).toContain('确认结束并保存？');
    expect(texts()).toContain('取消');
  });

  it('第二次点才 stop；成功后收起面板', async () => {
    stopMock.mockResolvedValue({ record: { id: 1 }, discarded: false });
    mount();
    click('结束并保存');
    click('确认结束并保存？');
    await act(async () => undefined);
    expect(stopMock).toHaveBeenCalledTimes(1);
    expect(closePanelMock).toHaveBeenCalledTimes(1);
  });

  it('stop 返回 null（被护栏挡下）→ 面板留着、确认步复位', async () => {
    stopMock.mockResolvedValue(null);
    mount();
    click('结束并保存');
    click('确认结束并保存？');
    await act(async () => undefined);
    expect(closePanelMock).not.toHaveBeenCalled();
    expect(texts()).toContain('结束并保存');
  });

  it('「取消」退回第一步，且一次都不 stop', () => {
    mount();
    click('结束并保存');
    click('取消');
    expect(stopMock).not.toHaveBeenCalled();
    expect(texts()).toContain('结束并保存');
  });

  it('不可逆语义进可访问名（读屏听到的是完整后果）', () => {
    mount();
    const btn = [...container.querySelectorAll('button')].find((b) => (b.textContent ?? '').trim() === '结束并保存');
    expect(btn?.getAttribute('aria-label')).toBe('结束并保存（不可撤销）');
  });

  it('Esc 关闭面板', () => {
    mount();
    const panel = container.querySelector('.timer-panel');
    if (!panel) throw new Error('未渲染 .timer-panel');
    act(() => {
      panel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(closePanelMock).toHaveBeenCalledTimes(1);
  });
});
