/**
 * Timing — 统计页的挂载判据（[0.13.2]）
 * -----------------------------------------------------------------------------
 * 纯函数判据（`usageRange.test.ts` / `usageInsights.test.ts`）证明算术对，
 * 但证明不了「页面真的能挂起来」：hooks 顺序、条件分支里读空对象、
 * 视图与页面之间的 props 名，这些都只有真渲染才看得出来。
 *
 * 这里只桩**系统边界**（`usage_stats_get` 那条命令），日键算术、合并、格式化全走真实现 ——
 * 桩掉 `usageActions` 会让「翻到昨天读的是哪一天」变成自证。
 *
 * 四条：单日读数 → 切「近 7 天」合并 → 点排行进详情再返回 → 真名与图标。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/* 没有它，`act(...)` 只发警告不生效：断言会在 React 还没刷完时就跑，红/绿都不可信。 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { UsagePage } from './UsagePage';
import type { UsageDayDto } from '../../types/domain/usage';

const h = vi.hoisted(() => ({ usageStatsGet: vi.fn() }));

vi.mock('../../services/ipc', () => ({
  ipc: {
    usageStatsGet: h.usageStatsGet,
    usageStatsSettings: vi.fn(async () => undefined),
  },
  errorText: () => '读取失败',
}));

/**
 * 每天固定的两行：抖音 1 小时 + Chrome 10 分钟。
 *
 * 故意一条**带图标**、一条**不带**：带的那条走 `<img>`，不带的那条必须落到首字瓦片 ——
 * 两种状态都要在真渲染里验过，否则「图没了就空一格」这种只在真机才看得见的观感问题
 * 会一路带到包上。
 */
function dayOf(date: string): UsageDayDto {
  return {
    supported: true,
    date,
    totalSec: 4200,
    rows: [
      {
        packageName: 'com.ss.android.ugc.aweme',
        sec: 3600,
        first: 0,
        last: 0,
        label: '抖音',
        icon: 'data:image/webp;base64,AAAA',
      },
      { packageName: 'com.android.chrome', sec: 600, first: 0, last: 0, label: 'Chrome' },
    ],
  };
}

let container: HTMLDivElement;
let root: Root;

/** 把微任务队列跑干净：页面 effect 里是 7 次串行 await。 */
async function settle() {
  await act(async () => {
    for (let i = 0; i < 12; i += 1) await Promise.resolve();
  });
}

async function mount() {
  await act(async () => {
    root.render(createElement(UsagePage));
  });
  await settle();
}

function buttonByText(label: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (button) => (button.textContent ?? '').trim() === label,
  );
  if (found == null) throw new Error(`找不到按钮：${label}`);
  return found;
}

async function click(element: Element) {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
  await settle();
}

beforeEach(() => {
  h.usageStatsGet.mockReset().mockImplementation(async (date: string) => dayOf(date));
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('统计页能挂起来并且读数对', () => {
  it('rd01_today_shows_the_day_total_from_the_same_rows', async () => {
    await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('今日合计');
    /* 3600 + 600 = 4200s = 1h 10m；行与合计同源（都由 rangeOf 由行求和） */
    expect(text).toContain('1h 10m');
    /* 真名，不是包名尾段（0.13.2 这里是 `Aweme` / `Chrome`，前者是错的） */
    expect(text).toContain('抖音');
    expect(text).toContain('Chrome');
    expect(text).not.toContain('Aweme');
    /* 占比与脚注都在：60m/70m ≈ 86% */
    expect(text).toContain('86%');
  });

  it('rd02_switching_to_week_aggregates_seven_days', async () => {
    await mount();
    await click(buttonByText('近 7 天'));
    const text = container.textContent ?? '';
    expect(text).toContain('近 7 天合计');
    /* 7 天 × 1h 10m = 8h 10m；日均 1h 10m */
    expect(text).toContain('8h 10m');
    expect(text).toContain('出现 7 天');
  });

  it('rd03_clicking_a_row_opens_detail_and_back_returns', async () => {
    await mount();
    const row = [...container.querySelectorAll('button')].find((button) =>
      (button.getAttribute('aria-label') ?? '').includes('查看每日趋势'),
    );
    expect(row, '排行行不是按钮或没有 aria-label，详情入口点不进去').toBeDefined();
    if (row == null) return;
    await click(row);

    const detail = container.textContent ?? '';
    expect(detail).toContain('近 7 天合计');
    expect(detail).toContain('最久一天');

    await click(buttonByText('‹'));
    expect(container.textContent ?? '').toContain('今日合计');
  });
});

/**
 * 真名与图标必须真的渲染出来 —— 源码级判据只能证明「写了 `displayName`」，
 * 证明不了「页面上显示的就是它」。
 *
 * 真机截图里的症状是整列 `Mm` / `Bili` / `Home`，也就是这张卡完全没用上系统真名。
 */
describe('真名与图标', () => {
  it('rd04_rows_render_the_real_label_and_the_icon', async () => {
    await mount();
    const text = container.textContent ?? '';
    expect(text).toContain('抖音');
    expect(text).not.toContain('Aweme');

    const icons = container.querySelectorAll('img.m-usage__icon');
    expect(icons.length, '有图标的那一行没有渲染 <img>').toBeGreaterThan(0);
    expect(icons[0].getAttribute('src') ?? '').toContain('data:image/webp');
    /* 名字在旁边的文本里，图标对读屏是噪音 */
    expect(icons[0].getAttribute('alt')).toBe('');

    /* 没有图标的那一行落首字瓦片，**不许**留一个空格子或破图 */
    const tiles = container.querySelectorAll('.m-usage__icon--letter');
    expect(tiles.length, '缺图标的那一行没有兜底瓦片').toBe(1);
    expect((tiles[0].textContent ?? '').trim()).toBe('C');
    expect(container.querySelectorAll('img.m-usage__icon').length).toBe(1);
  });
});
