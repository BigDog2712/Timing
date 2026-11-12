/**
 * Timing — 小条空闲滚轮调倒计时（V0.2.10 交互）
 * -----------------------------------------------------------------------------
 * 一格 5 分钟、上滚加下滚减，起点是「上次用过的时长」（没有则取参考设置的默认值），
 * 调完即 armed：小条数字直接显示该时长，点左侧圆环开始。
 *
 * 两个反直觉的实现点（拆出来是为了让 PillBar 只负责区域分派）：
 *   1. 基数必须读 store 的最新值：一次滚动会连发多个 wheel 事件，闭包里的 armedSec
 *      在这一帧内是旧值，连读两次「上次值」会把中间的档位全吞掉（实测连续两格只进一格）。
 *   2. 先把 delta 攒够一格再步进：触控板 / 精确滚轮会给 ±3 这种小 delta，
 *      逐事件步进会让一次轻扫跳过好几个 5 分钟档。
 */
import { useCallback, useRef } from 'react';
import type { WheelEvent as ReactWheelEvent } from 'react';
import { WHEEL_NOTCH_PX } from '../lib/constants';
import { COUNTDOWN_STEP_SEC, clampCountdownSec } from '../lib/countdown';
import { readCountdownDuration, useCountdownArmStore } from '../stores/countdownArm';

/**
 * @param enabled 仅空闲态接受滚轮（计时中滚动不应改任何东西）
 * @param fallbackSec 没有任何历史时长时的默认值（秒）
 */
export function usePillWheel(
  enabled: boolean,
  fallbackSec: number,
): (e: ReactWheelEvent<HTMLDivElement>) => void {
  const acc = useRef(0);

  return useCallback(
    (e: ReactWheelEvent<HTMLDivElement>) => {
      if (!enabled || e.deltaY === 0) return;
      e.preventDefault();
      /* deltaMode：0=像素 1=行 2=页；统一折成像素，一格按 100 计 */
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 100 : 1;
      const total = acc.current + e.deltaY * unit;
      const notches = Math.trunc(total / WHEEL_NOTCH_PX);
      if (notches === 0) {
        acc.current = total;
        return;
      }
      acc.current = total - notches * WHEEL_NOTCH_PX;
      const current = useCountdownArmStore.getState().armedSec ?? readCountdownDuration(fallbackSec);
      useCountdownArmStore.getState().arm(clampCountdownSec(current + notches * COUNTDOWN_STEP_SEC));
    },
    [enabled, fallbackSec],
  );
}
