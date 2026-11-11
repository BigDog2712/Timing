/**
 * Timing — 同期活动条：有数据才出现，且时长口径与记录面板一致
 * -----------------------------------------------------------------------------
 * 只钉两件在融合里真会退化的行为：
 *  ① 空数组必须整条不渲染（手机端 / Patina 库缺失 / 区间内无采样都是这条路径）。
 *     退化成渲染空壳时，面板上会多出一条没有内容的分隔线，用户只会觉得坏了。
 *  ② 时长走 `formatMinutes`（`2m` / `1h`），不是秒表口径的 `02:00`——
 *     两种口径混在同一个面板里，读数会被误当成计时器。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ActivitySlice } from '../../types/domain';
import { ActivityStrip } from './ActivityStrip';

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(activity: ActivitySlice[]) {
  act(() => {
    root.render(createElement(ActivityStrip, { activity }));
  });
}

function renderWithFocusApp(activity: ActivitySlice[], onFocusApp: (app: string) => void) {
  act(() => {
    root.render(createElement(ActivityStrip, { activity, onFocusApp }));
  });
}

function slice(over: Partial<ActivitySlice> = {}): ActivitySlice {
  return { app: 'Editor', exe: 'editor.exe', sec: 120, samples: 3, ...over };
}

describe('ActivityStrip', () => {
  it('没有数据时整条不渲染', () => {
    render([]);
    expect(container.querySelector('.activity-strip')).toBeNull();
  });

  it('按应用渲染并复用 formatMinutes 口径', () => {
    render([slice(), slice({ app: 'Browser', exe: 'chrome.exe', sec: 3600 })]);
    const chips = container.querySelectorAll('.activity-strip__chip');
    expect(chips).toHaveLength(2);
    expect(chips[0].textContent).toContain('Editor');
    expect(chips[0].textContent).toContain('2m');
    expect(chips[1].textContent).toContain('Browser');
    expect(chips[1].textContent).toContain('1h');
  });

  /* [P0-03] chip 由 span 改成 button：点它 = 去分析窗看这个应用这一天。
     钉住「点下去带的是**可执行名**」这件事——分析窗活动轨用可执行名当身份键，
     传显示名会静静地不命中（窗开了但一段都不亮）。 */
  it('点 chip 把可执行名交给 onFocusApp', () => {
    const seen: string[] = [];
    renderWithFocusApp([slice(), slice({ app: 'Browser', exe: 'chrome.exe' })], (exe) => {
      seen.push(exe);
    });
    const chips = container.querySelectorAll<HTMLButtonElement>('.activity-strip__chip');
    expect(chips[0].tagName).toBe('BUTTON');
    expect(chips[0].getAttribute('aria-label')).toContain('Editor');
    act(() => chips[1].click());
    expect(seen).toEqual(['chrome.exe']);
  });

  it('没有 onFocusApp 时 chip 仍渲染（形状与文案不变，只是不触发跳转）', () => {
    render([slice()]);
    const chip = container.querySelector<HTMLButtonElement>('.activity-strip__chip');
    expect(chip).not.toBeNull();
    expect(chip?.getAttribute('data-interactive')).toBeNull();
    expect(() => act(() => chip?.click())).not.toThrow();
  });
});
