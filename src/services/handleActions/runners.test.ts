/**
 * 手柄动作实现的单测（R-02「不用重建一份实现」+ A-02 的双向覆盖）
 * -----------------------------------------------------------------------------
 * 这一层唯一会「静默走错」的方式是**再造一份实现**：`today.panel` 里写一句
 * `useUiStore.getState().openPanel('records')` 也能跑通，但从此面板的打开口径有两处，
 * 改一处另一处就是死代码。所以判据不是「面板开了」，而是**同一个函数引用**。
 *
 * 第二条是覆盖性判据：目录 13 条 ↔ 实现 13 条**双向**互含。
 * 少一条 = 用户绑了却点了没反应；多一条 = 目录里查不到的僵尸实现。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { openTodayPanelMock, openDigestPanelMock } = vi.hoisted(() => ({
  openTodayPanelMock: vi.fn(),
  openDigestPanelMock: vi.fn(),
}));

vi.mock('../todayActions', () => ({
  openTodayPanel: openTodayPanelMock,
  openDigestPanel: openDigestPanelMock,
}));

import { HANDLE_ACTIONS } from '../../lib/handleCatalog';
import type { HandleActionCtx } from './guards';
import { RUNNERS } from './runners';

function makeCtx(): HandleActionCtx {
  return {
    status: 'idle',
    itemId: null,
    anchor: vi.fn(() => ({ x: 0, y: 0 })),
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
  };
}

beforeEach(() => {
  openTodayPanelMock.mockClear();
  openDigestPanelMock.mockClear();
});

describe('RUNNERS —— 复用既有服务，不重建实现', () => {
  it('r02_today_panel_is_the_same_reference_as_openTodayPanel', () => {
    /* `toBe` 而不是「调了之后面板开了」：包一层箭头函数同样能让面板打开，
       但那时「打开记录面板」的口径就有两份了。 */
    expect(RUNNERS['today.panel']).toBe(openTodayPanelMock);
    RUNNERS['today.panel']?.(makeCtx());
    expect(openTodayPanelMock).toHaveBeenCalledTimes(1);
  });

  it('r02_today_digest_is_the_same_reference_as_openDigestPanel', () => {
    expect(RUNNERS['today.digest']).toBe(openDigestPanelMock);
    RUNNERS['today.digest']?.(makeCtx());
    expect(openDigestPanelMock).toHaveBeenCalledTimes(1);
  });

  it('r02_note_list_uses_the_anchor_taken_at_dispatch_time', () => {
    /* 锚点必须由手柄在派发瞬间取（`ctx.anchor()` 内部是 getBoundingClientRect），
       注册表自己算几何 = 与既有便利贴手柄的落点口径分家 */
    const ctx = makeCtx();
    RUNNERS['note.list']?.(ctx);
    expect(ctx.anchor).toHaveBeenCalledTimes(1);
    expect(ctx.ui.openNotesList).toHaveBeenCalledWith({ x: 0, y: 0 });
  });

  it('r02_timer_slots_forward_to_the_timer_actions', () => {
    /* 计时动作只转发，不在注册表里重建编排（`useTimerActions` 是唯一出口） */
    const ctx = makeCtx();
    RUNNERS['timer.start']?.(ctx);
    RUNNERS['timer.pause']?.(ctx);
    RUNNERS['timer.stop']?.(ctx);
    expect(ctx.timer.start).toHaveBeenCalledTimes(1);
    expect(ctx.timer.togglePause).toHaveBeenCalledTimes(1);
    expect(ctx.timer.stop).toHaveBeenCalledTimes(1);
  });
});

describe('RUNNERS ↔ HANDLE_ACTIONS —— 双向覆盖', () => {
  it('a02_registry_and_runners_cover_each_other', () => {
    const catalogIds = HANDLE_ACTIONS.map((action) => action.id);
    const runnerIds = Object.keys(RUNNERS);
    expect(catalogIds.length).toBeGreaterThanOrEqual(10);

    const missingRunner = catalogIds.filter((id) => !runnerIds.includes(id));
    const zombieRunner = runnerIds.filter((id) => !catalogIds.includes(id));
    expect(missingRunner).toEqual([]);
    expect(zombieRunner).toEqual([]);
  });

  it('a03_ids_are_unique_and_stable', () => {
    /* id 是持久化键：重复 id 会让「绑了哪一条」变得不可判定 */
    const ids = HANDLE_ACTIONS.map((action) => action.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
