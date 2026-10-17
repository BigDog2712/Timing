/**
 * TickBar — 指针离开窗口即隐藏（V0.2.8）
 * -----------------------------------------------------------------------------
 * 用户要求：「所有唤起的悬浮菜单不应该出现在任务栏上；事项菜单也应该在鼠标离开后消失」。
 * 事项窗（`todos`）是浮在桌面上的面板而非主窗，指针离开它就隐藏（`hide()`，不销毁，
 * 下次 `open_todos_window` 还能立刻显示、滚动位置与状态都在）。
 *
 * 判定：`pointerleave` 打在 `documentElement` 上 = 指针离开窗口可视区。
 * 起 `WINDOW_LEAVE_HIDE_MS` 计时；期间指针回来（`pointerenter`）立即取消——贴着窗口边缘
 * 进出不会闪。
 *
 * 不用于：主窗（小条本身要一直在）、便利贴（用户明确要求例外）、设置窗（编辑到一半不能丢）。
 */
import { useEffect } from 'react';
import { WINDOW_LEAVE_HIDE_MS } from '../lib/constants';
import { hideCurrentWindow } from '../lib/window';

export function useWindowLeaveHide(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    if (!root) return;

    let timer: number | null = null;
    /* 必须先「进来过」才允许「离开即隐藏」：窗口刚显示时指针可能并不在它上面，
       pointerleave 会立刻触发，那样窗口一闪就没（用户根本没机会把鼠标移过去）。 */
    let entered = false;

    const cancel = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const onEnter = () => {
      entered = true;
      cancel();
    };

    const onLeave = () => {
      if (!entered) return;
      cancel();
      timer = window.setTimeout(() => {
        timer = null;
        void hideCurrentWindow();
      }, WINDOW_LEAVE_HIDE_MS);
    };

    /* 边缘抖动兜底：`mouseleave` 在部分 WebView2 版本上比 pointer 事件更可靠 */
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('mouseleave', onLeave);
    root.addEventListener('mouseenter', onEnter);

    return () => {
      cancel();
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('mouseleave', onLeave);
      root.removeEventListener('mouseenter', onEnter);
    };
  }, [enabled]);
}
