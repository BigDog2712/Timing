/**
 * Timing — P0-05 弹卡「取消零副作用」判据（融合 ARCH §P0-05 判据③）
 * -----------------------------------------------------------------------------
 * 这一批里有**一个**分支允许「什么都不做」，而它恰好是最容易被顺手写坏的：
 * 用户点了「取消」，实现却因为「反正已经拿到 itemId 了」先建了事项、或者先暂停了当前计时。
 * 症状是「我明明取消了，回来发现计时被切走了」——用户会认为应用在背着他改数据。
 *
 * 所以这里把「取消 = 只 onClose」钉成断言：`emitHostIntent` **一次都不许被调用**。
 * 分析窗没有写命令，唯一的写路径就是这条 intent；intent 一次没发 ⇒ 宿主状态逐字段不变
 * （判据本身由药丸侧 `get_timer_state` 前后比对完成，本测试守的是**发送侧**）。
 *
 * 另外钉住 idle / running 两种分支的文案与主体，以及「同名复用 / 无则新建」的如实告知。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** `vi.mock` 的工厂会被提升到 import 之上，所以共享状态必须用 `vi.hoisted` 造。 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
  /* 由每个用例改写的「宿主计时态」。形状与 `HostTimerView` 一致（类型在测试里不强绑）。 */
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
vi.mock('../../../app/hooks/useHostTimerState.ts', () => ({
  useHostTimerState: () => h.view,
}));

const { default: HistoryActivityActionDialog } = await import('./HistoryActivityActionDialog.tsx');

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET = {
  appName: 'VS Code',
  exeName: 'Code.exe',
  startTimeMs: new Date(2026, 10, 10, 14, 0, 0).getTime(),
  endTimeMs: new Date(2026, 10, 10, 14, 30, 0).getTime(),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  /* 补记用例用 `vi.spyOn(Date, 'now')` 把「现在」钉死（clamp 必须可复现） */
  vi.restoreAllMocks();
});

function render(onClose: () => void) {
  act(() => {
    root.render(createElement(HistoryActivityActionDialog, { target: TARGET, onClose }));
  });
}

/** `QuietDialog` 走 `createPortal`，所以要到 `document.body` 里找，不能在容器内找。 */
function byAction(action: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-history-activity-action="${action}"]`);
}

function text(action: string): string {
  return byAction(action)?.textContent?.trim() ?? '';
}

function runningView() {
  h.view = {
    status: 'running',
    session: { id: 91, itemId: 3, accumulatedSec: 751, runningSince: Date.now() - 400 },
    liveSec: 751,
    itemName: '写方案',
    todaySec: 4000,
    items: [{ id: 3, name: '写方案' }],
    ready: true,
  };
}

describe('HistoryActivityActionDialog（P0-05）', () => {
  it('p005_cancel_while_running_emits_no_intent_and_only_closes', () => {
    runningView();
    const onClose = vi.fn();
    render(onClose);

    const cancel = byAction('cancel');
    expect(cancel).not.toBeNull();
    act(() => cancel?.click());

    /* 核心判据：取消 = 零副作用。分析窗唯一的写路径就是这条 intent —— 一次都不许发。 */
    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('p005_cancel_while_idle_emits_no_intent_and_only_closes', () => {
    const onClose = vi.fn();
    render(onClose);

    act(() => byAction('cancel')?.click());

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('p005_idle_state_starts_directly_with_the_app_name', () => {
    const onClose = vi.fn();
    render(onClose);

    expect(text('start')).toBe('在 Timing 计这件事');
    act(() => byAction('start')?.click());

    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    /* 事项名 = 应用名（判据①），且只发「计这件事」这一条意图 */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'start_timer_for_activity',
      itemName: 'VS Code',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('p005_running_state_asks_before_switching', () => {
    runningView();
    const onClose = vi.fn();
    render(onClose);

    /* 先问，不直接开始：主体按钮必须变成「切换并开始」，并如实说出正在计什么、计了多久 */
    expect(text('start')).toBe('切换并开始');
    expect(text('cancel')).toBe('取消');
    expect(document.body.querySelector('[data-history-activity-busy="true"]')?.textContent)
      .toContain('写方案');
    expect(document.body.querySelector('[data-history-activity-busy="true"]')?.textContent)
      .toContain('12:31');
    /* 渲染本身不产生任何写入 */
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });

  it('p005_confirm_while_running_emits_exactly_one_switch_intent', () => {
    runningView();
    const onClose = vi.fn();
    render(onClose);

    act(() => byAction('start')?.click());

    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'start_timer_for_activity',
      itemName: 'VS Code',
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('p005_reuses_a_same_name_item_instead_of_creating_a_duplicate', () => {
    h.view = { ...h.view, items: [{ id: 7, name: 'vs code' }] };
    render(vi.fn());

    const hint = document.body.querySelector('[data-history-activity-match]');
    expect(hint?.getAttribute('data-history-activity-match')).toBe('reuse');
    expect(hint?.textContent).toContain('vs code');
  });

  it('p005_announces_a_new_item_when_no_same_name_exists', () => {
    render(vi.fn());

    const hint = document.body.querySelector('[data-history-activity-match]');
    expect(hint?.getAttribute('data-history-activity-match')).toBe('create');
    expect(hint?.textContent).toContain('VS Code');
  });

  it('p005_dialog_speaks_only_about_activity_not_analysis_concepts', () => {
    render(vi.fn());
    const body = document.body.textContent ?? '';

    /* 判据⑤：弹卡里不该出现分类 / 标签 / 泳道这类分析窗概念 */
    for (const word of ['分类', '标签', '泳道', '热力']) {
      expect(body).not.toContain(word);
    }
  });
});

describe('HistoryActivityActionDialog（P1-01 补记）', () => {
  /* 判据①：点「补记为计时记录」→ 一条 `backfill_record` 意图，起止 = **这一段**的起止。
     变异：改成「从现在开始」（不带 startedAt/endedAt）→ 本用例红。 */
  it('p101_backfill_emits_the_segment_bounds_not_now', () => {
    /* 「现在」钉在段尾之后 1 分钟：段是既成事实，clamp 不该改动它 */
    vi.spyOn(Date, 'now').mockReturnValue(TARGET.endTimeMs + 60_000);
    const onClose = vi.fn();
    render(onClose);

    expect(text('backfill')).toBe('补记为计时记录');
    act(() => byAction('backfill')?.click());

    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'backfill_record',
      itemName: 'VS Code',
      startedAt: TARGET.startTimeMs,
      endedAt: TARGET.endTimeMs,
    });
    /* intent 无回执：发完立刻关弹卡，不在这里等结果 */
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /* 判据②：右端 clamp 到 `min(endTimeMs, Date.now())`。
     变异：去掉 `Math.min(..., Date.now())` → 本用例拿到未来时刻 → 红。 */
  it('p101_backfill_clamps_the_right_edge_to_now', () => {
    const now = TARGET.endTimeMs - 60_000;
    vi.spyOn(Date, 'now').mockReturnValue(now);
    render(vi.fn());

    act(() => byAction('backfill')?.click());

    /* 段尾在未来（进行中的段取的是 `visibleEndMs`）→ 右端必须落到「现在」；
       左端不 clamp：段的起点是既成事实，动了就是记错账。 */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'backfill_record',
      itemName: 'VS Code',
      startedAt: TARGET.startTimeMs,
      endedAt: now,
    });
    expect(now).toBeLessThan(TARGET.endTimeMs);
  });

  /* 判据③：取消 / 关闭仍然零副作用（补记按钮的存在不得让它变成「顺手发一条」）。
     变异：把 emit 挪到无条件分支 → `p005_cancel_*` 与本用例一起红。 */
  it('p101_cancel_still_emits_no_intent_with_the_backfill_button_present', () => {
    runningView();
    const onClose = vi.fn();
    render(onClose);

    act(() => byAction('cancel')?.click());

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
