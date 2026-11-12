/**
 * Timing — 工具页「Timing 计时中」状态行判据（P0-07 §2）
 * -----------------------------------------------------------------------------
 * 这一行解决的是「选错工具丢统计」：工具页里的番茄钟 / 自由专注是**专注会话**，不写
 * `time_records`；真正在进账的计时只可能来自药丸。用户待在工具页时，这一行是唯一能看见
 * 「原来现在有一条正在进账的计时」的地方——所以它自己坏掉的症状是**静默的**：
 * 不报错、不空转，只是少了一条记录，用户要等到月底对不上账才发现。
 *
 * 钉四件事：
 *  ① `idle` / 未就绪不渲染（不留空壳，也不冷启动闪一下）；
 *  ② 时长是**秒表口径**（`formatClock` 的 `12:31`），不是概括口径（`formatDuration` 的 `12m`）；
 *  ③ 文本与 aria-label 都带上「计入时间账」，把账目性质说清（P0-07 的核心诉求）；
 *  ④ 点击只发 `show_pill` 意图、**只发一次**：分析窗没有写命令，回药丸只能表达意图。
 *
 * 另外用源码哨兵守「不另起一套读数」：本组件不许自己 `setInterval` / `listen` / 调 `ipc`，
 * 秒数只能来自 `useHostTimerState`（TB2-2 的单一路径）。那条守则放在
 * `../services/timingSemantics.test.ts` 里 —— 源码读取在 `.tsx` 用例里拿不到 `file:` 形式的
 * `import.meta.url`（jsdom 客户端转换给了 http 形态），放过去才能真的读到文件。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
  view: {
    status: 'idle',
    session: null,
    liveSec: 0,
    itemName: null,
    todaySec: null,
    items: [] as { id: number; name: string }[],
    ready: true,
  } as {
    status: string;
    session: { id: number; itemId: number; accumulatedSec: number; runningSince: number | null } | null;
    liveSec: number;
    itemName: string | null;
    todaySec: number | null;
    items: { id: number; name: string }[];
    ready: boolean;
  },
}));

vi.mock('../../../shared/i18n/index.ts', () => ({ useLocale: () => 'zh-CN' }));
vi.mock('../../../platform/runtime/hostIntentGateway.ts', () => ({
  emitHostIntent: h.emitHostIntent,
}));
vi.mock('../../../shell/hooks/useHostTimerState.ts', () => ({
  useHostTimerState: () => h.view,
}));

const { default: HostTimingStatusRow } = await import('./HostTimingStatusRow.tsx');

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.emitHostIntent.mockClear();
  h.view = {
    status: 'idle',
    session: null,
    liveSec: 0,
    itemName: null,
    todaySec: null,
    items: [],
    ready: true,
  };
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function render(): void {
  act(() => root.render(createElement(HostTimingStatusRow)));
}

function running(overrides: Partial<typeof h.view> = {}): void {
  h.view = {
    status: 'running',
    session: { id: 7, itemId: 3, accumulatedSec: 0, runningSince: 1 },
    liveSec: 751,
    itemName: '写周报',
    todaySec: 3600,
    items: [{ id: 3, name: '写周报' }],
    ready: true,
    ...overrides,
  };
}

describe('工具页「Timing 计时中」状态行（P0-07）', () => {
  it('renders_nothing_when_idle', () => {
    render();
    expect(container.querySelector('[data-tools-host-timing-row]')).toBeNull();
    /* 不留空壳：连「未在计时」的空条也不许有 */
    expect(container.textContent).toBe('');
  });

  it('renders_nothing_before_the_first_host_frame', () => {
    /* 冷启动先闪一下再跳成计时中，比完全不显示更像故障 */
    running({ ready: false });
    render();
    expect(container.querySelector('[data-tools-host-timing-row]')).toBeNull();
  });

  it('shows_item_name_and_stopwatch_duration_while_running', () => {
    running();
    render();
    const row = container.querySelector('[data-tools-host-timing-row]');
    expect(row?.getAttribute('data-tools-host-timing-row')).toBe('running');
    expect(row?.getAttribute('data-tools-host-timing-item')).toBe('写周报');
    expect(row?.getAttribute('data-tools-host-timing-live-sec')).toBe('751');
    /* 751 秒 → 12:31（秒表口径）；若换成 formatDuration 会变成「12m」，日内读数就丢了 */
    expect(container.textContent).toContain('12:31');
    expect(container.textContent).not.toContain('12m');
  });

  it('says_out_loud_whether_this_counts_in_the_time_log', () => {
    running();
    render();
    expect(container.textContent).toContain('Timing 计时中');
    expect(container.textContent).toContain('计入时间账');
    expect(container.querySelector('[data-tools-host-timing-row]')?.getAttribute('aria-label'))
      .toContain('计入时间账');
  });

  it('never_calls_a_paused_timer_running', () => {
    /* 暂停时时间不涨，说「计时中」会让用户以为还在计 */
    running({ status: 'paused' });
    render();
    expect(container.textContent).toContain('Timing 已暂停');
    expect(container.textContent).not.toContain('Timing 计时中');
  });

  it('falls_back_to_the_item_id_when_the_name_is_not_resolved_yet', () => {
    running({ itemName: null });
    render();
    expect(container.querySelector('[data-tools-host-timing-row]')?.getAttribute('data-tools-host-timing-item'))
      .toBe('#3');
  });

  it('asks_the_pill_to_come_back_with_a_single_intent', () => {
    running();
    render();
    const row = container.querySelector('[data-tools-host-timing-row]') as HTMLButtonElement;
    act(() => row.click());
    /* 分析窗没有写命令：回药丸只能表达意图，且不许连发 */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: 'show_pill' });
  });
});
