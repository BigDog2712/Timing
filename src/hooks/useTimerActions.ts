/**
 * TickBar — 计时动作编排（跨 store 的唯一业务出口）
 * -----------------------------------------------------------------------------
 * 组件只调用本 Hook 的动作，不直接拼装 ipc 时序；错误统一转成 uiStore.notice。
 * 撤销失败（TIMER_NO_UNDO / TIMER_ALREADY_RUNNING）必须**友好提示不崩溃**。
 */
import { useCallback, useMemo } from 'react';
import { errorText, ipc } from '../services/ipc';
import { SYSTEM_ITEM_ID } from '../types/domain';
import type { ResolveAction, SwitchMode } from '../types/domain';
import { findItem, useItemStore } from '../stores/itemStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

export interface TimerActions {
  /** 开始计时（缺省用 lastItemId / 首个事项 / 未归类） */
  start: (itemId?: number) => Promise<void>;
  /** 依当前状态：idle→开始，running→暂停，paused→继续 */
  togglePause: () => Promise<void>;
  /** 结束并保存（右键单击 / Enter） */
  stop: () => Promise<void>;
  /** 撤销结束（撤销条） */
  undo: (recordId: number) => Promise<void>;
  /** 计时中换事项（end_and_start 分段 / just_switch 仅改归属） */
  switchTo: (itemId: number, mode?: SwitchMode) => Promise<void>;
  /** 丢弃当前会话：结束并软删除该记录（上下文菜单「丢弃本次记录」） */
  discardCurrent: () => Promise<void>;
  /** 崩溃恢复三选一 */
  resolveRecover: (action: ResolveAction) => Promise<void>;
}

export function useTimerActions(): TimerActions {
  const notify = useCallback((err: unknown) => {
    useUiStore.getState().setNotice({ text: errorText(err), tone: 'danger' });
  }, []);

  const start = useCallback(
    async (itemId?: number) => {
      const items = useItemStore.getState().items;
      const lastItemId = useTimerStore.getState().state.lastItemId;
      const target = itemId ?? findItem(items, lastItemId)?.id ?? items[0]?.id ?? SYSTEM_ITEM_ID;
      try {
        await ipc.startTimer({ itemId: target });
        await useTimerStore.getState().refresh();
        useUiStore.getState().closePanel();
      } catch (err) {
        notify(err);
      }
    },
    [notify],
  );

  const togglePause = useCallback(async () => {
    const status = useTimerStore.getState().state.status;
    try {
      if (status === 'idle') {
        await start();
        return;
      }
      if (status === 'running') await ipc.pauseTimer();
      else await ipc.resumeTimer();
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
    }
  }, [start, notify]);

  const stop = useCallback(async () => {
    try {
      const record = await ipc.stopTimer();
      useUiStore.getState().flashEnded();
      useUiStore.getState().beginUndo(record);
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  }, [notify]);

  const undo = useCallback(
    async (recordId: number) => {
      try {
        await ipc.undoStop({ recordId });
        useUiStore.getState().clearUndo();
      } catch (err) {
        // TIMER_NO_UNDO（窗口过期）/ TIMER_ALREADY_RUNNING（已开新计时）：忽略并同步状态
        useUiStore.getState().clearUndo();
        notify(err);
      } finally {
        await useTimerStore.getState().refresh().catch(() => undefined);
      }
    },
    [notify],
  );

  const switchTo = useCallback(
    async (itemId: number, mode: SwitchMode = 'end_and_start') => {
      try {
        await ipc.switchItem({ itemId, mode });
        await useTimerStore.getState().refresh();
      } catch (err) {
        notify(err);
      }
    },
    [notify],
  );

  const discardCurrent = useCallback(async () => {
    try {
      const record = await ipc.stopTimer();
      await ipc.deleteRecord({ id: record.id });
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  }, [notify]);

  const resolveRecover = useCallback(
    async (action: ResolveAction) => {
      try {
        await ipc.resolveOpenRecord({ action });
        useUiStore.getState().setRecover(null);
        await useTimerStore.getState().refresh();
      } catch (err) {
        notify(err);
      }
    },
    [notify],
  );

  return useMemo(
    () => ({ start, togglePause, stop, undo, switchTo, discardCurrent, resolveRecover }),
    [start, togglePause, stop, undo, switchTo, discardCurrent, resolveRecover],
  );
}
