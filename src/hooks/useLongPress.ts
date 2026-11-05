/**
 * Timing — 触屏长按（500ms，位移超过阈值即取消）
 * -----------------------------------------------------------------------------
 * 桌面的右键菜单在手机上只能靠长按（PRD §5 D11）。三个必须写死的口径：
 *   1. **500ms**：短于这个数会与「点一行就开始计」抢事件，长于它用户以为没反应；
 *   2. **位移阈值 10px**：列表页要滚动，手指一滑就必须放弃长按，否则滑到底时弹出菜单；
 *   3. 长按触发后**吞掉随后的 pointerup 点击**，否则「长按出菜单」的同时还会执行一次点击动作
 *      （例如点行 = 开始计时，菜单弹出的瞬间又开了一条记录）。
 *
 * 只用 Pointer Events：Android WebView / 桌面 Chromium 同一套，不需要 touch 兼容分支。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';

/** 长按判定时长（ms） */
export const LONG_PRESS_MS = 500;
/** 移动超过这个距离（px）视为滚动，取消长按 */
const MOVE_TOLERANCE_PX = 10;

export interface LongPressHandlers {
  onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
  onContextMenu: (e: { preventDefault: () => void }) => void;
}

/**
 * @param onLongPress 长按触发（唤出底部菜单）
 * @param onTap 轻点触发（可省略：只做长按的容器不传，点击交给子元素）
 */
export function useLongPress(
  onLongPress: () => void,
  onTap?: () => void,
  delay: number = LONG_PRESS_MS,
): LongPressHandlers {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const clearTimer = useCallback(() => {
    if (timer.current != null) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
    origin.current = null;
  }, []);

  const onPointerDown = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      /* 只认主键 / 触摸：鼠标右键仍走桌面那套 contextmenu（浏览器里方便调试） */
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      clearTimer();
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      timer.current = window.setTimeout(() => {
        fired.current = true;
        timer.current = null;
        onLongPress();
      }, delay);
    },
    [clearTimer, delay, onLongPress],
  );

  const onPointerMove = useCallback(
    (e: ReactPointerEvent<HTMLElement>) => {
      const start = origin.current;
      if (!start) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > MOVE_TOLERANCE_PX) clearTimer();
    },
    [clearTimer],
  );

  const onPointerUp = useCallback(() => {
    const wasLongPress = fired.current;
    const hadOrigin = origin.current != null;
    clearTimer();
    fired.current = false;
    /* 长按已经处理过这次交互；没有进行中的按下（例如滚动取消后抬起）也不算点击 */
    if (wasLongPress || !hadOrigin) return;
    onTap?.();
  }, [clearTimer, onTap]);

  const onPointerCancel = useCallback(() => {
    clearTimer();
    fired.current = false;
  }, [clearTimer]);

  /* [V0.11.2] 卸载时清掉未到期的计时器：行被删 / 切页后，500ms 后仍会触发长按回调，
     对一个已经不存在的行执行删除（或打开已卸载组件里的 Sheet）。 */
  useEffect(() => clearTimer, [clearTimer]);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onContextMenu: (e) => e.preventDefault(),
  };
}
