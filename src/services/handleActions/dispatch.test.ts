/**
 * 手柄动作派发的单测（§5.2 判定表 #12 / #13 与 §4.3 的派发侧反证）
 * -----------------------------------------------------------------------------
 * 派发只有四个出口，其中**三个都是「什么都不做」**，彼此差别只在「要不要提示」。
 * 这种形状最难靠 code review 守住：任何一次把 `return` 写丢，用户看到的就是
 * 「点了没反应」或「没绑的槽也在骂人」。所以四个出口各钉一条。
 *
 * `a02_injected_action_is_dispatchable` 是 A-02 的反证型判据：往目录里 push 一个假动作、
 * 往 RUNNERS 里塞一个 spy，不改任何 UI 代码就能证明「新增一条即生效」。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { HANDLE_ACTIONS } from '../../lib/handleCatalog';
import type { HandleActionCtx } from './guards';
import { dispatchHandleAction } from './dispatch';
import { RUNNERS } from './runners';

/** 造一份全 vi.fn() 的 ctx：本用例组关心的是「谁被调了」，不是真实业务。 */
function makeCtx(over: Partial<HandleActionCtx> = {}): HandleActionCtx {
  const ctx: HandleActionCtx = {
    status: 'idle',
    itemId: null,
    anchor: vi.fn(() => ({ x: 10, y: 20 })),
    timer: {
      start: vi.fn(),
      togglePause: vi.fn(),
      stop: vi.fn(),
      undo: vi.fn(),
      switchTo: vi.fn(),
      startOrSwitch: vi.fn(),
      discardCurrent: vi.fn(),
      resolveRecover: vi.fn(),
    },
    ui: {
      openPanel: vi.fn(),
      openNotesList: vi.fn(),
      openCountdownMenu: vi.fn(),
      openMoyuMenu: vi.fn(),
    },
    notice: vi.fn(),
    ...over,
  };
  return ctx;
}

afterEach(() => {
  /* 反证用例会往两张表里注入假动作，必须退回原状，否则后面所有用例都被污染 */
  delete RUNNERS['test.fake'];
  const index = HANDLE_ACTIONS.findIndex((action) => action.id === 'test.fake');
  if (index >= 0) HANDLE_ACTIONS.splice(index, 1);
});

describe('dispatchHandleAction —— 空槽 / 未知 id 都必须完全静默', () => {
  it('a01_empty_slot_is_silent', () => {
    /* 槽值是 `null` = 用户故意留空。0 动作、0 提示（A-01） */
    const ctx = makeCtx();
    dispatchHandleAction(null, ctx);
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.timer.start).not.toHaveBeenCalled();
    expect(ctx.timer.togglePause).not.toHaveBeenCalled();
    expect(ctx.ui.openNotesList).not.toHaveBeenCalled();
  });

  it('a04_unknown_id_is_silent', () => {
    /* 配置里残留了已删除的动作：不崩、不派发、不提示（A-04）。
       变异：把 `findHandleAction` 的查空改成 fallback 到第一条目录项 → 本条红。 */
    const ctx = makeCtx();
    expect(() => dispatchHandleAction('today.panel.legacy', ctx)).not.toThrow();
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.timer.start).not.toHaveBeenCalled();
  });
});

describe('dispatchHandleAction —— 护栏不通过要提示，通过才执行', () => {
  it('a07_guard_blocks_with_notice', () => {
    /* 运行中再点「开始」：0 动作 + 1 条提示（A-07，唯一会被用户看见的「拒绝」） */
    const ctx = makeCtx({ status: 'running' });
    dispatchHandleAction('timer.start', ctx);
    expect(ctx.timer.start).not.toHaveBeenCalled();
    expect(ctx.notice).toHaveBeenCalledTimes(1);
    expect(ctx.notice).toHaveBeenCalledWith('已在计时中');
  });

  it('a07_guard_passes_then_the_runner_runs', () => {
    /* 同一槽在空闲态必须真的执行 —— 否则上一条用例可能只是「什么都没实现」也绿 */
    const ctx = makeCtx({ status: 'idle', itemId: 7 });
    dispatchHandleAction('timer.start', ctx);
    expect(ctx.notice).not.toHaveBeenCalled();
    expect(ctx.timer.start).toHaveBeenCalledTimes(1);
    expect(ctx.timer.start).toHaveBeenCalledWith(7);
  });

  it('a07_guardless_action_is_not_blocked_by_state', () => {
    /* 目录里没有护栏的动作（如 `today.panel`）在任何状态下都该执行 */
    const ctx = makeCtx({ status: 'running' });
    dispatchHandleAction('today.panel', ctx);
    expect(ctx.notice).not.toHaveBeenCalled();
  });
});

describe('dispatchHandleAction —— A-02 反证：注入一条即生效', () => {
  it('a02_injected_action_is_dispatchable', () => {
    const spy = vi.fn();
    HANDLE_ACTIONS.push({ id: 'test.fake', label: '假动作', group: 'ui' });
    RUNNERS['test.fake'] = spy;

    const ctx = makeCtx();
    dispatchHandleAction('test.fake', ctx);
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(ctx);
  });

  it('a02_catalog_entry_without_runner_does_not_throw', () => {
    /* 目录 +1 条但忘记在 RUNNERS 补实现：不许抛（缺实装由双向覆盖用例去抓，
       而不是让用户的点击炸在运行时） */
    HANDLE_ACTIONS.push({ id: 'test.fake', label: '假动作', group: 'ui' });
    const ctx = makeCtx();
    expect(() => dispatchHandleAction('test.fake', ctx)).not.toThrow();
    expect(ctx.notice).not.toHaveBeenCalled();
  });
});
