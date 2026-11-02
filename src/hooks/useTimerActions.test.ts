/**
 * `useTimerActions.stop` —— V0.3.4「最短记录时长」分支的行为契约（ADR-023）。
 *
 * 为什么值得单独写：`stop_timer` 的返回形状从 `TimeRecord` 换成了
 * `StopResult { record, discarded }`，于是「结束后到底该给用户什么」变成了**两条互斥分支**：
 *   - `discarded = true`  → 什么都没存：不许开撤销条，也不许播 900ms 结束态（绿勾是「已保存」
 *                           的确认），只给一条中性提示说明原因；
 *   - `discarded = false` → 照常 `flashEnded()` + `beginUndo(record)`，3 秒撤销兜底。
 * 这两条分支一旦接反，用户会看到「闪了下绿勾但记录列表里没有」或者「有记录却撤不回来」，
 * 而 TypeScript 完全拦不住（两个字段都是必填）。所以钉在这里。
 *
 * 测试手法：`useTimerActions` 是 hook（内部 useCallback），不能在渲染外直接调用。
 * 项目暂不引入 RTL（见 vitest.config.ts 的取向），因此用 `renderToStaticMarkup` 跑一次
 * 极简探针组件把 actions 抓出来——只求拿到闭包，不渲染任何 UI，也不依赖 DOM 交互。
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_DEFAULTS } from '../mocks/mockSeed';
import { ipc, IpcError } from '../services/ipc';
import { useSettingsStore } from '../stores/settingsStore';
import { IDLE_TIMER_STATE, useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import type { StopResult, TimeRecord } from '../types/domain';
import { useTimerActions, type TimerActions } from './useTimerActions';

/** 一条「已结束」的记录快照（字段与 Rust `TimeRecord` 一一对应） */
const RECORD: TimeRecord = {
  id: 42,
  itemId: 1,
  status: 'saved',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_120_000,
  accumulatedSec: 120,
  runningSince: null,
  note: null,
  mode: 'countup',
  targetSec: null,
};

/**
 * 渲染一次探针组件把 `useTimerActions()` 的返回值抓出来。
 *
 * 探针返回 `null`：本用例只关心动作在 store 上留下的痕迹，不关心任何 DOM。
 */
function grabActions(): TimerActions {
  const box: { actions: TimerActions | null } = { actions: null };

  function Probe() {
    box.actions = useTimerActions();
    return null;
  }

  renderToStaticMarkup(createElement(Probe));

  const actions = box.actions as TimerActions | null;
  if (actions == null) throw new Error('探针组件没有跑到 useTimerActions()');
  return actions;
}

/** 每个用例都从「刚启动、无任何瞬时 UI」的干净状态出发 */
function resetState(): void {
  useUiStore.setState({ undoRecord: null, undoDeadline: null, endedAt: null, notice: null });
  useTimerStore.setState({ state: IDLE_TIMER_STATE, loaded: false });
  useSettingsStore.setState({ referenceSettings: null });
}

describe('useTimerActions.stop —— 短会话被忽略时不产生任何「已保存」痕迹', () => {
  beforeEach(resetState);
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('discarded=true：不开撤销条、不播结束态，只给中性提示（阈值取设置，不是写死 30）', async () => {
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: true });
    vi.spyOn(ipc, 'getTimerState').mockResolvedValue(IDLE_TIMER_STATE);
    /* 阈值改成 45 秒：提示文案必须跟着设置走，写死 30 会在这里红 */
    useSettingsStore.setState({
      referenceSettings: { ...REFERENCE_DEFAULTS, minRecordSeconds: 45 },
    });

    await grabActions().stop();

    const ui = useUiStore.getState();
    expect(ui.undoRecord, '被丢弃的记录不该进撤销条').toBeNull();
    expect(ui.undoDeadline, '没有撤销条就不该有截止时间').toBeNull();
    expect(ui.endedAt, '什么都没存，不该播 900ms 结束态').toBeNull();
    expect(ui.notice).toEqual({ text: '不足 45 秒，未记录', tone: 'info' });
  });

  it('discarded=false：播结束态 + 开撤销条，不打扰用户', async () => {
    const result: StopResult = { record: RECORD, discarded: false };
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue(result);
    vi.spyOn(ipc, 'getTimerState').mockResolvedValue(IDLE_TIMER_STATE);

    await grabActions().stop();

    const ui = useUiStore.getState();
    expect(ui.endedAt, '正常结束才有结束态视觉确认').not.toBeNull();
    expect(ui.undoRecord).toEqual(RECORD);
    expect(ui.undoDeadline, '撤销窗截止时间必须落上').not.toBeNull();
    expect(ui.notice, '正常结束不该弹提示').toBeNull();
  });

  it('参考设置未就绪（首个会话就结束）时兜底 30 秒', async () => {
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: true });
    vi.spyOn(ipc, 'getTimerState').mockResolvedValue(IDLE_TIMER_STATE);

    await grabActions().stop();

    expect(useUiStore.getState().notice).toEqual({ text: '不足 30 秒，未记录', tone: 'info' });
  });

  it('stop 失败：走 danger 提示，同样不产生撤销条', async () => {
    vi.spyOn(ipc, 'stopTimer').mockRejectedValue(
      new IpcError('TIMER_NOT_RUNNING', '没有进行中的计时'),
    );
    vi.spyOn(ipc, 'getTimerState').mockResolvedValue(IDLE_TIMER_STATE);

    await grabActions().stop();

    const ui = useUiStore.getState();
    expect(ui.notice).toEqual({ text: '当前没有进行中的计时', tone: 'danger' });
    expect(ui.undoRecord).toBeNull();
    expect(ui.endedAt).toBeNull();
  });
});
