import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';
import { DRAG_CLICK_SWALLOW_MS, DRAG_THRESHOLD_PX } from '../lib/constants';
import { startCurrentWindowDrag } from '../lib/window';

/** Separate native drag ownership from zone click actions. Never invoke during synthetic probes. */
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
      window.setTimeout(() => { swallow.current = false; }, DRAG_CLICK_SWALLOW_MS);
      void startCurrentWindowDrag();
    },
    onUp() { origin.current = null; },
    onClickCapture(e: MouseEvent) {
      if (!swallow.current) return;
      swallow.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  };
}
