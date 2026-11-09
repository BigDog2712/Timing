/**
 * Timing — 结束计时的那一条手机端出口（[V0.11.32]）
 * -----------------------------------------------------------------------------
 * 为什么不是直接调 `useTimerActions().stop()`：
 *
 * 主人要的口径是「没想好名字也能先计时，结束的时候再补名字」。补名字这件事**只在手机端**
 * 成立（桌面有一整列事项和一个能改归属的记录编辑面板），所以它不能写进 `stop()`，
 * 否则桌面也会弹一个手机样式的面板。
 *
 * 这里的唯一职责：结束 → 看这条记录是不是挂在「未归类」名下 → 是就开命名面板。
 * 三种不该弹的情况都短在这里，调用方（大按钮 / 悬浮条 / 通知栏）不用各写一遍：
 *   1. `stop` 失败（回 null）；
 *   2. 这段短到被后端丢了（`discarded`，什么都没存，问名字没有意义）；
 *   3. 记录已经有归属（用户在计时中换过事项）。
 */
import { useCallback } from 'react';
import { isUnnamedRecord } from '../lib/unnamed';
import { useMobileUiStore } from '../stores/mobileUiStore';
import { useTimerActions } from './useTimerActions';

export function useStopNaming(): () => Promise<void> {
  const { stop } = useTimerActions();
  const openSheet = useMobileUiStore((s) => s.openSheet);

  return useCallback(async () => {
    const result = await stop();
    if (!result || result.discarded) return;
    if (!isUnnamedRecord(result.record)) return;
    openSheet({ kind: 'nameStop', record: result.record });
  }, [stop, openSheet]);
}
