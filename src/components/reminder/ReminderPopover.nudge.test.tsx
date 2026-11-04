/**
 * TickBar — 待办提醒卡（V0.3.12 / ADR-030）渲染回归
 * -----------------------------------------------------------------------------
 * 两张卡共用 `ReminderPopover`，靠 `stage` 换正文与动作：
 *   - stage 1（轻提醒，T-15）：「15 分钟后开始 / 要不要改时间？」+ 三个平移档 + 「不用改」；
 *   - stage 2（自动开始，T-5）：「HH:MM 开始 / 当前计时结束后自动开始？」+ 「结束后自动开始」「现在就开始」。
 * 只验渲染（动作落库需要 IPC，另由后端用例覆盖）。
 */
import { act, createElement } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ReminderPopover } from './ReminderPopover';
import type { ReminderPopoverState } from '../../stores/uiStore';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const T0 = 1_700_000_000_000;

let container: HTMLDivElement;
let root: Root;

async function mount(ui: ReactElement): Promise<HTMLDivElement> {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(ui);
  });
  return container;
}

function nudgeState(stage: 1 | 2): ReminderPopoverState {
  return {
    pos: { x: 0, y: 0 },
    mode: 'nudge',
    target: 'todo',
    targetId: 7,
    title: '写周报',
    remindAt: T0,
    nudge: { todoId: 7, title: '写周报', remindAt: T0, stage },
  };
}

const buttonTexts = (el: HTMLElement) =>
  [...el.querySelectorAll('button')].map((b) => b.textContent?.trim() ?? '');

beforeEach(() => {
  document.body.innerHTML = '';
});

afterEach(async () => {
  await act(async () => {
    root?.unmount();
  });
  container?.remove();
});

describe('轻提醒卡（stage 1）', () => {
  it('问要不要改时间，并给三个平移档', async () => {
    const el = await mount(createElement(ReminderPopover, { state: nudgeState(1) }));
    expect(el.textContent).toContain('轻提醒 · 写周报');
    expect(el.textContent).toContain('15 分钟后开始');
    expect(el.textContent).toContain('要不要改时间');

    const texts = buttonTexts(el);
    expect(texts).toContain('推迟 15 分钟');
    expect(texts).toContain('推迟 1 小时');
    expect(texts).toContain('推到明天此刻');
    expect(texts).toContain('不用改');
  });
});

describe('自动开始卡（stage 2）', () => {
  it('问结束后是否自动开始，两个动作都在', async () => {
    const el = await mount(createElement(ReminderPopover, { state: nudgeState(2) }));
    expect(el.textContent).toContain('即将开始 · 写周报');
    expect(el.textContent).toContain('当前计时结束后自动开始');

    const texts = buttonTexts(el);
    expect(texts).toContain('结束后自动开始');
    expect(texts).toContain('现在就开始');
    expect(texts).not.toContain('推迟 15 分钟');
  });
});
