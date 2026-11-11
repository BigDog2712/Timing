/**
 * Timing — 弹卡的三态呈现与「递解析后的名字」（P1-06 判据②③）
 * -----------------------------------------------------------------------------
 * 为什么单独成文件：`HistoryActivityActionDialog.test.tsx` 已 268 行（P0-05 的「取消零副作用」
 * 判据 + P1-01 补记），再塞这几条必破 300 行硬上限。两半分工：
 *  · 那份管「取消不写库 / 补记发什么」；本份管「**呈现哪一态**」与「**intent 递哪个名字**」。
 *
 * 判据②：`data-history-activity-match` 必须是 `reuse` / `suggest` / `create` 三态之一，
 *        `contained` 只是**建议**，不许标成 `reuse`（标错了用户会以为已经并进老事项）。
 * 判据③：intent 里递「建议命中的那个事项名」，不是活动原名。递原名 → 宿主按精确名找不到
 *        → 新建一条 → 事项表出现两个几乎同名的条目（用户视角：怎么多了一个）。
 */
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
  items: [] as { id: number; name: string }[],
}));

vi.mock('../../../shared/i18n/index.ts', () => ({ useLocale: () => 'zh-CN' }));
vi.mock('../../../platform/runtime/hostIntentGateway.ts', () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock('../../../app/hooks/useHostTimerState.ts', () => ({
  useHostTimerState: () => ({
    status: 'idle',
    session: null,
    liveSec: 0,
    itemName: null,
    todaySec: null,
    items: h.items,
    ready: true,
  }),
}));

const { default: HistoryActivityActionDialog } = await import('./HistoryActivityActionDialog.tsx');

(globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

const TARGET = {
  appName: 'VS Code',
  exeName: 'Code.exe',
  startTimeMs: Date.UTC(2026, 10, 10, 6, 0, 0),
  endTimeMs: Date.UTC(2026, 10, 10, 6, 30, 0),
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  h.emitHostIntent.mockClear();
  h.items = [];
  /* 「现在」钉在段尾之后（段是既成事实）：否则 `Math.min(endTimeMs, Date.now())` 随真实
     时钟漂移，断言会时绿时红 */
  vi.spyOn(Date, 'now').mockReturnValue(TARGET.endTimeMs + 60_000);
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

function render(onClose: () => void = vi.fn()) {
  act(() => {
    root.render(createElement(HistoryActivityActionDialog, { target: TARGET, onClose }));
  });
}

function byAction(action: string): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(`[data-history-activity-action="${action}"]`);
}

function matchState(): string | null {
  return document.body.querySelector('[data-history-activity-match]')?.getAttribute('data-history-activity-match') ?? null;
}

function matchText(): string {
  return document.body.querySelector('[data-history-activity-match]')?.textContent ?? '';
}

describe('HistoryActivityActionDialog × itemNameMatch（P1-06 判据②：三态）', () => {
  it('p106_contained_suggestion_reads_as_suggest_not_reuse', () => {
    h.items = [{ id: 9, name: 'VS Code 调试' }];
    render();

    /* `vscode`(6) ⊂ `vscode调试`(8) = 0.75 ≥ 0.6 → contained，但**只是建议** */
    expect(matchState()).toBe('suggest');
    expect(matchText()).toContain('建议复用');
    expect(matchText()).toContain('VS Code 调试');
  });

  it('p106_exact_still_reads_as_reuse', () => {
    h.items = [{ id: 9, name: 'vs code' }];
    render();

    expect(matchState()).toBe('reuse');
    expect(matchText()).toContain('将计入已有事项');
  });

  it('p106_no_hit_reads_as_create', () => {
    h.items = [{ id: 9, name: '写代码' }];
    render();

    expect(matchState()).toBe('create');
    expect(matchText()).toContain('新建事项');
  });

  it('p106_rendering_alone_still_emits_nothing', () => {
    h.items = [{ id: 9, name: 'VS Code 调试' }];
    render();

    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });
});

describe('HistoryActivityActionDialog × itemNameMatch（P1-06 判据③：递解析后的名字）', () => {
  it('p106_start_intent_carries_the_suggested_item_name', () => {
    h.items = [{ id: 9, name: 'VS Code 调试' }];
    render();

    act(() => byAction('start')?.click());

    /* 变异：改回 `itemName: appName` → 这里拿到 'VS Code' → 红（宿主侧会新建一条） */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'start_timer_for_activity',
      itemName: 'VS Code 调试',
    });
  });

  it('p106_backfill_intent_carries_the_suggested_item_name', () => {
    h.items = [{ id: 9, name: 'VS Code 调试' }];
    render();

    act(() => byAction('backfill')?.click());

    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'backfill_record',
      itemName: 'VS Code 调试',
      startedAt: TARGET.startTimeMs,
      endedAt: TARGET.endTimeMs,
    });
  });

  it('p106_without_a_hit_the_activity_name_is_used', () => {
    render();

    act(() => byAction('backfill')?.click());

    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: 'backfill_record',
      itemName: 'VS Code',
      startedAt: TARGET.startTimeMs,
      endedAt: TARGET.endTimeMs,
    });
  });
});
