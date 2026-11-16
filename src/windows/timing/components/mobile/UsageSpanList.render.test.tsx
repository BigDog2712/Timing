/**
 * Timing — 时段列表的展示门槛（[0.12.8]）
 * -----------------------------------------------------------------------------
 * 用户的原话是「时间统计有误，为多段不到一分钟计时」。根因之一是配对口径（见
 * `UsageTotals.wiring.test.ts`），另一个是**列表把什么都列出来**：解锁瞬间的 2 秒桌面、
 * 看一眼通知就退出的 8 秒，一天能有上百条，一屏全是「09:01 - 09:01」。
 *
 * 这里挂真的 DOM 验证三件事，纯函数判据覆盖不到：
 *   ① 不到 1 分钟的段**不出现**在列表里；
 *   ② 它们**不是被丢掉**，而是折成一句「另有 N 次」；
 *   ③ 合计与时段对不上时，缺口如实说出来 —— 小窗、分屏、挂机这些时段系统算账、
 *      事件流里却没有「离开」信号，不解释的话用户会以为时钟错了。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

/* 没有它，`act(...)` 只发警告不生效：断言会在 React 还没刷完时就跑，红/绿都不可信。 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { UsageSpanList } from './UsageSpanList';
import type { UsageSpan } from '../../types/domain/usage';

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
});

/** 本地时刻 → 毫秒。不写 `Date.parse('…T09:00:00')`：无时区后缀那串按 UTC 解会差 8 小时。 */
function at(hour: number, minute = 0): number {
  return new Date(2026, 10, 15, hour, minute, 0, 0).getTime();
}

function render(spans: UsageSpan[], totalSec?: number): string {
  act(() => {
    root.render(createElement(UsageSpanList, { spans, emptyHint: '这天没有记录。', totalSec }));
  });
  return container.textContent ?? '';
}

describe('UsageSpanList 的展示门槛', () => {
  it('rd10_short_spans_are_not_listed_but_are_counted', () => {
    const text = render([
      { from: at(9, 0), to: at(9, 30) },
      { from: at(10, 0), to: at(10, 0) + 8_000 },
      { from: at(11, 0), to: at(11, 0) + 45_000 },
    ]);
    /* 30 分钟那段要在 */
    expect(text).toContain('09:00 - 09:30');
    /* 8 秒、45 秒那两段不许出现在时刻列里 */
    expect(text).not.toContain('10:00 - 10:00');
    expect(text).not.toContain('11:00 - 11:00');
    /* 但必须折成计数，不能悄悄消失 */
    expect(text).toContain('另有 2 次打开不到 1 分钟');
  });

  it('rd11_all_short_is_its_own_empty_state_not_the_generic_one', () => {
    const text = render([
      { from: at(9, 0), to: at(9, 0) + 5_000 },
      { from: at(10, 0), to: at(10, 0) + 20_000 },
    ]);
    /* 「打开过 2 次但都很短」≠「这天没用过」：不能共用一句「这天没有记录。」 */
    expect(text).toContain('这天打开过 2 次，每次不到 1 分钟。');
    expect(text).not.toContain('这天没有记录。');
  });

  it('rd12_gap_between_total_and_listed_is_spelled_out', () => {
    /* 合计 2 小时，但只记到 30 分钟的段 ⇒ 缺 1 小时 30 分，必须说出来 */
    const text = render([{ from: at(9, 0), to: at(9, 30) }], 2 * 3600);
    expect(text).toContain('没有分段记录');
    expect(text).toContain('1 小时 30 分');
  });

  it('rd13_no_gap_no_noise', () => {
    /* 合计与段加起来一致（30 分钟）⇒ 不该出现缺口那句话 */
    const text = render([{ from: at(9, 0), to: at(9, 30) }], 30 * 60);
    expect(text).not.toContain('没有分段记录');
  });
});
