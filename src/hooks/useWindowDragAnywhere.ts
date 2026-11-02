/**
 * TickBar — 「整窗任意位置拖动」通用钩子（便利贴：整个面板都能拖）
 * -----------------------------------------------------------------------------
 * 无边框透明窗（便利贴）没有标题栏，`data-tauri-drag-region` 只对**命中它自己的**
 * 元素生效——面板 90% 面积是正文 textarea，所以用户只能在右上角那 10px 圆点条上拖动。
 *
 * 本钩子改成「按下 + 位移超阈值 → 调原生 startDragging」，覆盖整块面板：
 *   - 阈值 4px：单击（放光标、点圆点）照常落到控件上，不会被误判成拖动；
 *   - `[data-no-drag]` 子树（两枚圆点、缩放手柄）永不触发拖动；
 *   - **Shift + 拖动** 保留给「选中文本」（textarea 原生行为）；
 *   - 拖动成功后的 click 被吞掉，避免松手时误触下面的按钮；
 *   - 事件监听挂在 window 上（而非 DOM 捕获），不干扰 textarea 的光标/选区逻辑。
 *
 * [V0.3.1] 拖动**不再改鼠标指针**（用户口径「鼠标状态应为默认状态」）：
 * 原先拖动期间会把整窗切成 grabbing，便利贴上光标的每次形变都会被注意到。
 */

import { useEffect, useRef } from 'react';
import type { MouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DRAG_CLICK_SWALLOW_MS, DRAG_THRESHOLD_PX } from '../lib/constants';
import { startCurrentWindowDrag } from '../lib/window';

export function useWindowDragAnywhere() {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  /** window 上的临时监听器清理器（必须在组件卸载时兜底运行） */
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanupRef.current?.(), []);

  const detach = () => {
    cleanupRef.current?.();
    cleanupRef.current = null;
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (!e.isTrusted || e.button !== 0) return;
    // Shift + 拖动 = 正常选中文本（保命开关，别把选区也拖走）
    if (e.shiftKey) return;
    const target = e.target;
    if (target instanceof Element && target.closest('[data-no-drag]')) return;

    detach();
    origin.current = { x: e.screenX, y: e.screenY };

    const onMove = (moveEvent: PointerEvent) => {
      const point = origin.current;
      if (!point) return;
      if (
        Math.abs(moveEvent.screenX - point.x) < DRAG_THRESHOLD_PX &&
        Math.abs(moveEvent.screenY - point.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      origin.current = null;
      swallow.current = true;
      window.setTimeout(() => {
        swallow.current = false;
      }, DRAG_CLICK_SWALLOW_MS);
      detach();
      /* [V0.3.1] 不改光标：便利贴上一切都用默认箭头（用户口径）。 */
      void startCurrentWindowDrag();
    };

    const onUp = () => {
      origin.current = null;
      detach();
    };

    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    cleanupRef.current = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  };

  const onClickCapture = (e: MouseEvent) => {
    if (!swallow.current) return;
    swallow.current = false;
    e.preventDefault();
    e.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}
