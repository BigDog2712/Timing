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
import { useSettingsStore } from '../stores/settingsStore';
import { useTimerStore } from '../stores/timerStore';
import { useUiStore } from '../stores/uiStore';

/** 「最短记录时长」兜底：与后端 `ReferenceSettings::default().min_record_seconds` 同值 */
const FALLBACK_MIN_RECORD_SEC = 30;

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
  /**
   * [V0.4.2] 「点这一条就该开始计这条」的统一入口：空闲直接开始；正在计别的就分段切过去；
   * 就是当前这一条——跑着不动、暂停着继续。
   *
   * 存在的理由：后端 `switch(end_and_start)` 只接受**非运行中**会话（`timer::switch` 的守卫），
   * 所以「边跑边换」必须先暂停冻结累计再分段。之前几个入口直接调 `switchTo`，运行中点击
   * 只会收到 `TIMER_ALREADY_RUNNING`，「点了没反应」的观感就是这么来的。
   */
  startOrSwitch: (itemId: number) => Promise<void>;
  /** 丢弃当前会话：结束并软删除该记录（上下文菜单「丢弃本次记录」） */
  discardCurrent: () => Promise<void>;
  /** 崩溃恢复三选一；`includeGap` = 把退出期间并入累计（默认 false，R-2） */
  resolveRecover: (action: ResolveAction, includeGap?: boolean) => Promise<void>;
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
      /* 先本地翻：IPC 往返那 ~30ms 里若用户立刻右键数字，`status` 还是旧值，
         摸鱼菜单会整个吞掉（实测「暂停后 0ms 右键」约 1/8 次丢失）。 */
      useTimerStore.getState().setStatus(status === 'running' ? 'paused' : 'running');
      if (status === 'running') await ipc.pauseTimer();
      else await ipc.resumeTimer();
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  }, [start, notify]);

  const stop = useCallback(async () => {
    try {
      const result = await ipc.stopTimer();
      if (result.discarded) {
        /* [V0.3.4] 低于「最短记录时长」：后端已软删除，**不**开撤销条——
           让用户撤销一条「本来就不该存在」的记录没有意义（ADR-023）。
           也**不**播结束态闪一下（900ms 绿勾是「已保存」的确认，这里什么都没存）。 */
        const threshold =
          useSettingsStore.getState().referenceSettings?.minRecordSeconds ?? FALLBACK_MIN_RECORD_SEC;
        useUiStore.getState().setNotice({ text: `不足 ${threshold} 秒，未记录`, tone: 'info' });
      } else {
        useUiStore.getState().flashEnded();
        useUiStore.getState().beginUndo(result.record);
      }
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
        /* 失败也要回读：失败的可能是「暂停后分段」的第二跳，本地状态已经过期 */
        await useTimerStore.getState().refresh().catch(() => undefined);
      }
    },
    [notify],
  );

  const startOrSwitch = useCallback(
    async (itemId: number) => {
      const current = useTimerStore.getState().state;
      if (current.status === 'idle') {
        await start(itemId);
        return;
      }
      if (current.session?.itemId === itemId) {
        /* 点的是当前这一条：跑着就什么都不做，暂停着就当「继续」 */
        if (current.status === 'paused') await togglePause();
        return;
      }
      try {
        if (current.status === 'running') await ipc.pauseTimer();
      } catch (err) {
        notify(err);
        await useTimerStore.getState().refresh().catch(() => undefined);
        return;
      }
      await switchTo(itemId, 'end_and_start');
    },
    [start, togglePause, switchTo, notify],
  );

  const discardCurrent = useCallback(async () => {
    try {
      await ipc.discardTimer();
      await useTimerStore.getState().refresh();
    } catch (err) {
      notify(err);
      await useTimerStore.getState().refresh().catch(() => undefined);
    }
  }, [notify]);

  const resolveRecover = useCallback(
    async (action: ResolveAction, includeGap = false) => {
      try {
        await ipc.resolveOpenRecord({ action, includeGap });
        useUiStore.getState().setRecover(null);
        await useTimerStore.getState().refresh();
      } catch (err) {
        notify(err);
      }
    },
    [notify],
  );

  return useMemo(
    () => ({ start, togglePause, stop, undo, switchTo, startOrSwitch, discardCurrent, resolveRecover }),
    [start, togglePause, stop, undo, switchTo, startOrSwitch, discardCurrent, resolveRecover],
  );
}
