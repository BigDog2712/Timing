/**
 * Timing — 泳道「记录变更门铃」判据（P1-01 判据④）
 * -----------------------------------------------------------------------------
 * `useTimingSegments` 的取数只依赖 `dayStartMs`/`dayEndMs`（P0 为防「每跳一秒打一次 IPC」
 * 的刻意设计）。副作用是：**任何**记录变更都不会刷新泳道。补记（P1-01）正好落在那个缝里——
 * 用户点了「补记为计时记录」，宿主库多了几行，界面上什么都没有，看起来像没生效。
 *
 * 所以这里钉住门铃本身：宿主广播 `timer:state-changed` → 本 hook 必须**重新取数**。
 * 变异：删掉 `subscribeHostTimerState` 那段订阅 → 第二次取数不发生 → 本文件红。
 *
 * 注意载荷语义：补记**不改计时状态**，所以那一帧是「状态没变」的广播。本 hook 只把它当
 * 「记录可能变了」的信号，不解析载荷 —— 这条也应被钉住（用例②）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  /** 宿主广播回调；订阅时被 `subscribeHostTimerState` 填进来 */
  bump: null as (() => void) | null,
  subscribed: 0,
  unsubscribed: 0,
  loadSpans: vi.fn(async () => [] as unknown[]),
  loadNames: vi.fn(async () => [] as unknown[]),
}));

vi.mock('../../../platform/runtime/hostTimerGateway.ts', () => ({
  subscribeHostTimerState: async (cb: () => void) => {
    h.subscribed += 1;
    h.bump = cb;
    return () => {
      h.unsubscribed += 1;
      h.bump = null;
    };
  },
}));
vi.mock('../../../platform/runtime/timingOverlapGateway.ts', () => ({
  loadTimingRecordSpans: h.loadSpans,
  loadTimingItemNames: h.loadNames,
}));

const { useTimingSegments } = await import('./useTimingSegments.ts');

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

/** 一天 00:00–24:00 的视口（`useTimingSegments` 只读这五个数，不需要别的上下文） */
const WINDOW = {
  dayStartMs: new Date(2026, 10, 9, 0, 0, 0).getTime(),
  dayEndMs: new Date(2026, 10, 10, 0, 0, 0).getTime(),
  viewportStartMs: new Date(2026, 10, 9, 0, 0, 0).getTime(),
  viewportEndMs: new Date(2026, 10, 10, 0, 0, 0).getTime(),
  visibleEndMs: new Date(2026, 10, 9, 23, 0, 0).getTime(),
};

function Harness() {
  useTimingSegments(WINDOW);
  return null;
}

let container: HTMLDivElement;
let root: Root;

/** 把 effect 里的两条异步链（订阅 + 取数）跑干净 */
async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(async () => {
  h.bump = null;
  h.subscribed = 0;
  h.unsubscribed = 0;
  h.loadSpans.mockClear();
  h.loadNames.mockClear();
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Harness));
  });
  await flush();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe('useTimingSegments（P1-01 判据④：补记后泳道必须刷新）', () => {
  it('p101_refetches_records_when_a_timer_state_broadcast_arrives', async () => {
    /* 首帧取一次（日期区间没变过，此后不该自己重复取） */
    expect(h.loadSpans).toHaveBeenCalledTimes(1);

    await act(async () => {
      h.bump?.();
    });
    await flush();

    /* 判据④：广播到达 → 重新取当天的记录。少了它，补记后泳道永远不变 */
    expect(h.loadSpans).toHaveBeenCalledTimes(2);
    expect(h.loadSpans.mock.calls[1]).toEqual([WINDOW.dayStartMs, WINDOW.dayEndMs]);
  });

  it('p101_treats_a_state_unchanged_frame_as_a_records_signal', async () => {
    /* 载荷根本不看：补记不改状态，这一帧「状态没变」正是预期 —— 仍然要刷新。
       两帧分两次 act 推进（同一批内 React 会合并成一次渲染，那是它该做的事）。 */
    await act(async () => {
      h.bump?.();
    });
    await flush();
    await act(async () => {
      h.bump?.();
    });
    await flush();

    expect(h.loadSpans).toHaveBeenCalledTimes(3);
  });

  it('p101_unsubscribes_on_unmount', () => {
    /* 历史页翻页会反复挂载/卸载；漏退订会攒出一堆监听器（每跳一次就多取一轮数） */
    act(() => root.unmount());
    expect(h.unsubscribed).toBe(1);
    /* 已经卸载过，afterEach 里的 unmount 是幂等空操作 */
    root = createRoot(document.createElement('div'));
  });
});
