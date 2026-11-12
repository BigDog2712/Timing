/**
 * `countdownActions.start` —— 「结束当前并开始」时对 `StopResult` 的处理（ADR-023）。
 *
 * 这条路径很容易被漏掉：它不是「结束计时」按钮，但在计时中选摸鱼菜单的快捷项、
 * 或选倒计时预设时都会**隐式**结束当前会话。V0.3.4 给它加了阈值判定，前端要做的是：
 *   - `discarded = true`  → 补一条「不足 N 秒，未记录」，否则用户会以为那段被悄悄吞了；
 *   - 两种情况都**不开撤销条**——紧接着就 `start_countdown`，`undo_stop` 必然撞
 *     `TIMER_ALREADY_RUNNING`，弹一条撤不掉的条比不弹更糟（见该文件头注释）。
 *
 * 这里还钉一个「不能因为旧段太短就中断新会话」的不变式：`start_countdown` 必须照常调用。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REFERENCE_DEFAULTS } from '../mocks/mockSeed';
import { countdownActions } from './countdownActions';
import { ipc } from './ipc';
import { useSettingsStore } from '../stores/settingsStore';
import { IDLE_TIMER_STATE, useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';
import type { TimeRecord } from '../types/domain';

const RECORD: TimeRecord = {
  id: 7,
  itemId: 1,
  status: 'saved',
  startedAt: 1_700_000_000_000,
  endedAt: 1_700_000_020_000,
  accumulatedSec: 20,
  runningSince: null,
  note: null,
  mode: 'countup',
  targetSec: null,
};

function resetState(): void {
  useUiStore.setState({ undoRecord: null, undoDeadline: null, endedAt: null, notice: null });
  useTimerStore.setState({ state: IDLE_TIMER_STATE, loaded: false });
  useSettingsStore.setState({ referenceSettings: null });
}

describe('countdownActions.start（replace=true：结束当前并开始）', () => {
  beforeEach(() => {
    resetState();
    vi.spyOn(ipc, 'getTimerState').mockResolvedValue(IDLE_TIMER_STATE);
    vi.spyOn(ipc, 'startCountdown').mockResolvedValue(RECORD);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('旧段被阈值忽略：提示「未记录」，但新倒计时照常开始', async () => {
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: true });

    await countdownActions.start(1, 600, true);

    expect(ipc.startCountdown, '旧段再短也不能挡住新会话').toHaveBeenCalledWith({
      itemId: 1,
      targetSec: 600,
    });
    expect(useUiStore.getState().notice).toEqual({ text: '不足 30 秒，未记录', tone: 'info' });
    expect(useUiStore.getState().undoRecord, '新会话已开跑，撤销条必然撤不掉，不该出现').toBeNull();
  });

  it('旧段正常保存：不额外提示、也不开撤销条（同上原因）', async () => {
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: false });

    await countdownActions.start(1, 600, true);

    expect(ipc.startCountdown).toHaveBeenCalled();
    expect(useUiStore.getState().notice).toBeNull();
    expect(useUiStore.getState().undoRecord).toBeNull();
  });

  it('replace=false（空闲启动）：根本不调 stop_timer', async () => {
    const stop = vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: false });

    await countdownActions.start(undefined, 1500, false);

    expect(stop).not.toHaveBeenCalled();
    expect(ipc.startCountdown).toHaveBeenCalledWith({ itemId: undefined, targetSec: 1500 });
  });

  it('提示文案跟随设置里的阈值', async () => {
    useSettingsStore.setState({
      referenceSettings: { ...REFERENCE_DEFAULTS, minRecordSeconds: 90 },
    });
    vi.spyOn(ipc, 'stopTimer').mockResolvedValue({ record: RECORD, discarded: true });

    await countdownActions.start(1, 600, true);

    expect(useUiStore.getState().notice).toEqual({ text: '不足 90 秒，未记录', tone: 'info' });
  });
});
