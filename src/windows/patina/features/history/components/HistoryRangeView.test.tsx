import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UiText } from '../../../shared/i18n/index.ts';
import { buildHistoryRangeDays } from '../services/historyRange.ts';
import { buildHistoryRangeAggregate } from '../services/historyRangeAggregate.ts';
import { HISTORY_RANGE_COPY } from '../rangeCopy.ts';
import HistoryRangeView from './HistoryRangeView.tsx';
import type { HistoryRangeDataState } from '../hooks/useHistoryRangeData.ts';

/**
 * 区间总览的 DOM 判据（jsdom 不做布局，所以只钉**结构、数字、交互**）。
 *
 * 这个视图最容易犯的错不是样式，而是"接错源"：便利贴接了待办、事项排行接了应用、
 * 点柱不回单日。三者都不会报错，只会安静地显示一个看着合理的数字。
 */
const COPY = HISTORY_RANGE_COPY['zh-CN'];
const UI_TEXT = {
  common: { retry: '重试', refreshFailed: '刷新失败，显示上次成功结果。' },
  date: { today: '今天', yesterday: '昨天' },
} as unknown as UiText;

const D1 = new Date(2026, 10, 10, 0, 0, 0, 0).getTime();
const D2 = new Date(2026, 10, 11, 0, 0, 0, 0).getTime();
const D3 = new Date(2026, 10, 12, 0, 0, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

const AGGREGATE = buildHistoryRangeAggregate({
  days: buildHistoryRangeDays('2026-11-10', '2026-11-11', D3),
  sessions: [{ exeName: 'code.exe', appName: 'VS Code', startMs: D1 + HOUR, endMs: D1 + 3 * HOUR }],
  /* 时间轴吃的是**未聚合的原始会话**：`sessions` 那份被后端按「天 × 应用」压过，
     起点统一落在当日 00:00，画不出"几点到几点"（见 historyRangeAggregate 的注释）。 */
  timelineSessions: [{ exeName: 'code.exe', appName: 'VS Code', startMs: D1 + HOUR, endMs: D1 + 3 * HOUR }],
  records: [{ itemId: 7, seconds: 1800, startedAt: D1 + 2 * HOUR }],
  items: [{ id: 7, name: '写方案' }],
  notes: [{ id: 11, itemId: 7, content: '第一行\n第二行', createdAt: D2 + HOUR }],
  todos: [{ id: 21, title: '交任务书', plannedAt: D2, doneAt: D2 + 2 * HOUR }],
  unnamedItemLabel: '未命名计时',
});

let container: HTMLDivElement;
let root: Root;
let mounted: boolean;

function renderState(state: HistoryRangeDataState): void {
  act(() => {
    root.render(createElement(HistoryRangeView, {
      copy: COPY,
      uiText: UI_TEXT,
      locale: 'zh-CN' as const,
      data: state,
      onOpenDay: state === readyState ? openDay : vi.fn(),
    }));
  });
}

const openDay = vi.fn();
const retry = vi.fn();
const readyState: HistoryRangeDataState = {
  aggregate: AGGREGATE,
  loading: false,
  error: false,
  retry,
  resolvedRange: null,
};

function query(selector: string): HTMLElement | null {
  return container.querySelector<HTMLElement>(selector);
}

function all(selector: string): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(selector));
}

beforeEach(() => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  openDay.mockClear();
  retry.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
});

afterEach(() => {
  if (mounted) act(() => root.unmount());
  container.remove();
});

describe('HistoryRangeView · 四块数据各就各位', () => {
  it('v01_four_summary_metrics_read_from_the_aggregate', () => {
    renderState(readyState);
    const values = all('[data-history-range-metric]').map((el) => el.textContent ?? '');
    expect(values).toHaveLength(4);
    /* 2 小时应用 / 30 分钟事项 / 1 张便利贴 / 1 个待办 */
    expect(values[0]).toContain('2');
    expect(values[1]).toContain('30');
    expect(values[2]).toContain('1');
    expect(values[3]).toContain('1');
  });

  it('v02_apps_and_items_land_in_their_own_panels', () => {
    /* 接错源时这里会红：应用卡里出现「写方案」= 接了 items，反之亦然 */
    renderState(readyState);
    const apps = query('[data-history-range-ranking="apps"]');
    const items = query('[data-history-range-ranking="items"]');
    expect(apps?.textContent).toContain('VS Code');
    expect(apps?.textContent).not.toContain('写方案');
    expect(items?.textContent).toContain('写方案');
    expect(items?.textContent).not.toContain('VS Code');
  });

  it('v03_notes_show_first_line_and_their_item_name', () => {
    renderState(readyState);
    const notes = query('[data-history-range-record-block="notes"]');
    expect(notes?.textContent).toContain('第一行');
    expect(notes?.textContent).not.toContain('第二行');
    expect(notes?.textContent).toContain('挂在「写方案」');
  });

  it('v04_todos_show_completed_titles', () => {
    renderState(readyState);
    const todos = query('[data-history-range-record-block="todos"]');
    expect(todos?.textContent).toContain('交任务书');
    expect(todos?.textContent).toContain('原定');
  });

  it('v05_daily_bars_cover_every_day_and_click_opens_that_day', () => {
    /* 柱 = 入口：点 11-10 必须回 11-10，不是"回今天" */
    renderState(readyState);
    const bars = all('[data-history-range-day]');
    expect(bars).toHaveLength(2);
    expect(bars.map((bar) => bar.getAttribute('data-history-range-day')))
      .toEqual(['2026-11-10', '2026-11-11']);

    act(() => {
      bars[0].click();
    });
    expect(openDay).toHaveBeenCalledWith('2026-11-10');
  });

  it('v06_empty_day_is_still_clickable', () => {
    /* 11-11 那天没有应用活动（data-empty），但"这天为什么空"正是要去看的问题 */
    renderState(readyState);
    const emptyBar = query('[data-history-range-day="2026-11-11"]');
    expect(emptyBar?.getAttribute('data-empty')).toBe('true');
    act(() => {
      emptyBar?.click();
    });
    expect(openDay).toHaveBeenCalledWith('2026-11-11');
  });
});

describe('HistoryRangeView · 三态', () => {
  it('v07_loading_without_data_shows_the_measuring_line', () => {
    renderState({ aggregate: null, loading: true, error: false, retry, resolvedRange: null });
    expect(query('[data-history-range-loading]')?.textContent).toContain(COPY.loading);
    expect(query('[data-history-range-ready]')).toBeNull();
  });

  it('v08_all_sources_failed_shows_retry_and_calls_it', () => {
    renderState({ aggregate: null, loading: false, error: true, retry, resolvedRange: null });
    const panel = query('[data-history-range-error]');
    expect(panel?.textContent).toContain(COPY.readFailed);
    act(() => {
      panel?.querySelector('button')?.click();
    });
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('v09_refresh_failure_keeps_showing_the_previous_numbers', () => {
    /* 0.12.1 的刷新纪律：有数据可画就不许换成骨架。刷新失败只加一条提示条。 */
    renderState({ aggregate: AGGREGATE, loading: false, error: true, retry, resolvedRange: null });
    expect(query('[data-history-range-ready]')).not.toBeNull();
    expect(query('[role="alert"]')?.textContent).toContain('刷新失败');
    expect(all('[data-history-range-metric]')).toHaveLength(4);
  });
});

describe('HistoryRangeView · 单日档与区间同一套块', () => {
  it('v10_single_day_hides_the_daily_bars_but_keeps_the_four_metrics', () => {
    /* 单日 = dayCount 1 的区间：四块照旧，逐日柱不画（一根柱子不表达趋势，点自己也没意义）。
       这条同时防"单日偷偷退回另一套版式"——版式一旦分叉，两边的数字就又会按不同口径算。 */
    act(() => {
      root.render(createElement(HistoryRangeView, {
        copy: COPY,
        uiText: UI_TEXT,
        locale: 'zh-CN' as const,
        data: readyState,
        onOpenDay: openDay,
        showDailyBars: false,
        showTimeline: false,
      }));
    });
    expect(all('[data-history-range-metric]')).toHaveLength(4);
    expect(all('[data-history-range-day]')).toHaveLength(0);
    expect(all('[data-history-range-ranking]')).toHaveLength(2);
    expect(query('[data-history-range-records]')).not.toBeNull();
    /* 单日已有那根可缩放的时间轴，不该再出现一行静止的逐日带 */
    expect(query('[data-history-range-timeline]')).toBeNull();
  });

  it('v11_daily_bars_come_back_for_ranges', () => {
    renderState(readyState);
    expect(all('[data-history-range-day]')).toHaveLength(2);
  });

  it('v12_ranges_get_one_timeline_lane_per_day', () => {
    /* 一行一天、横轴 0–24h。缺了这一块，区间视图就只剩数字，
       用户没法回答"那几天几点在忙"——这正是本次补的东西。 */
    renderState(readyState);
    const lanes = all('[data-history-range-timeline-day]');
    expect(lanes).toHaveLength(2);
    expect(lanes.map((lane) => lane.getAttribute('data-history-range-timeline-day')))
      .toEqual(['2026-11-10', '2026-11-11']);
    /* 11-10 那格有 09:00–12:00 的活动，块必须画在它自己那一行里 */
    expect(lanes[0].querySelectorAll('[data-history-range-timeline-block]')).toHaveLength(1);
    expect(lanes[1].querySelectorAll('[data-history-range-timeline-block]')).toHaveLength(0);
  });
});
