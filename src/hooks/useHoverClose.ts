/**
 * TickBar — 指针离开即收的浮层（V0.2.7）
 * -----------------------------------------------------------------------------
 * 用户要求：**所有由悬浮条触发的浮层**，在指针离开后自动收起；便利贴例外。
 * 便利贴是独立窗口（`note-{id}`，自己一份文档），天然不挂这个 hook，故「例外」是结构性的。
 *
 * 判定规则（比 `pointerleave` 宽松，避免「手一抖就没了」）：
 * - 指针落在 `KEEP_ALIVE_SELECTOR` 命中的容器上（小条本身 / 任何浮层）= 还在用小条这套 UI，**不计时**；
 * - 指针离开这些容器后起 `HOVER_CLOSE_GRACE_MS` 计时，期间回到任意容器即取消；
 * - 计时到点才真正 `onClose()`。
 *
 * 为什么用 document 级 pointermove 而不是元素上的 pointerleave：
 * 浮层与小条之间常有几像素空隙，指针穿过去的一瞬间会触发 `pointerleave`，
 * 只看元素自身会在「从菜单移回小条」时误收。
 */
import { useEffect, useRef } from 'react';
import { HOVER_CLOSE_GRACE_MS } from '../lib/constants';

/** 指针停在这些容器上时不算「离开」：小条 + 各类浮层（菜单 / 面板 / 记录 / 提醒卡） */
const KEEP_ALIVE_SELECTOR = '.pill, .menu, .panel, .records, .reminder, .note';

export function useHoverClose(onClose: () => void, enabled = true): void {
  /* 回调常是内联箭头函数，用 ref 托住，避免每次渲染重挂 document 监听 */
  const closeRef = useRef(onClose);

  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return;

    let timer: number | null = null;

    const cancel = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const handleMove = (e: PointerEvent) => {
      const target = e.target as Element | null;
      /* 还在小条或浮层里 → 取消待收 */
      if (target?.closest?.(KEEP_ALIVE_SELECTOR)) {
        cancel();
        return;
      }
      /* 已经离开并且已经在倒计时 → 不重置，避免「一直动鼠标永不收」 */
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        closeRef.current();
      }, HOVER_CLOSE_GRACE_MS);
    };

    const leave = () => {
      if (timer != null) return;
      timer = window.setTimeout(() => {
        timer = null;
        closeRef.current();
      }, HOVER_CLOSE_GRACE_MS);
    };
    const root = document.documentElement;
    document.addEventListener('pointermove', handleMove, true);
    // Leaving the native WebView produces no further document pointermove.
    root.addEventListener('pointerleave', leave);
    root.addEventListener('mouseleave', leave);
    root.addEventListener('pointerenter', cancel);
    root.addEventListener('mouseenter', cancel);
    return () => {
      cancel();
      document.removeEventListener('pointermove', handleMove, true);
      root.removeEventListener('pointerleave', leave);
      root.removeEventListener('mouseleave', leave);
      root.removeEventListener('pointerenter', cancel);
      root.removeEventListener('mouseenter', cancel);
    };
  }, [enabled]);
}
