import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { DRAG_CLICK_SWALLOW_MS, DRAG_THRESHOLD_PX } from '../lib/constants';
import { markDragActive, markDragIdle } from '../lib/dragState';
import { startCurrentWindowDrag } from '../lib/window';

/**
 * Separate native drag ownership from zone click actions. Never invoke during synthetic probes.
 *
 * [0.13.x] 越过阈值那一刻额外置位 `lib/dragState` 的模块级拖拽标志：`entry/App.tsx`
 * 要靠它判断「托盘双击高亮能不能把圆点临时展开成条」—— 拖动中改窗口尺寸会打断拖动。
 * 置位/复位点与既有的 `swallow` 完全一致（同一个 4px 阈值、同一次松手），
 * 所以「算不算拖」只有一处口径；复位另有 `dragState` 里的超时兜底。
 */
export function usePillDrag() {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  return {
    onDown(e: PointerEvent) {
      if (!e.isTrusted || e.button !== 0) return;
      origin.current = { x: e.screenX, y: e.screenY };
    },
    onMove(e: PointerEvent) {
      const point = origin.current;
      if (!point) return;
      if (Math.abs(e.screenX - point.x) < DRAG_THRESHOLD_PX &&
          Math.abs(e.screenY - point.y) < DRAG_THRESHOLD_PX) return;
      origin.current = null;
      swallow.current = true;
      markDragActive();
      window.setTimeout(() => { swallow.current = false; }, DRAG_CLICK_SWALLOW_MS);
      void startCurrentWindowDrag();
    },
    onUp() {
      origin.current = null;
      markDragIdle();
    },
    onClickCapture(e: MouseEvent) {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
