/**
 * TickBar — 指针离开窗口即隐藏（V0.2.8 / V0.3.9 加打字豁免）
 * -----------------------------------------------------------------------------
 * 用户要求：「所有唤起的悬浮菜单不应该出现在任务栏上；事项菜单也应该在鼠标离开后消失」。
 * 事项窗（`todos`）是浮在桌面上的面板而非主窗，指针离开它就隐藏（`hide()`，不销毁，
 * 下次 `open_todos_window` 还能立刻显示、滚动位置与状态都在）。
 *
 * 判定：`pointerleave` 打在 `documentElement` 上 = 指针离开窗口可视区。
 * 起 `WINDOW_LEAVE_HIDE_MS` 计时；期间指针回来（`pointerenter`）立即取消——贴着窗口边缘
 * 进出不会闪。
 *
 * [V0.3.9] 打字豁免：焦点在窗内文本控件（`input` / `textarea` / `contenteditable`）里且窗口
 * 仍有焦点时，`documentElement` 的 leave 一律不算离开。WebView2 在 **IME 候选窗弹出** /
 * 焦点切换 / 窗口重绘时会补派一次假 leave，旧逻辑按「人走了」起算，到了 420ms 就把窗收了
 * ——用户看到的就是「新增待办打着字，悬浮窗没了」。这与 `useHoverClose` 里那条豁免同源，
 * 理由与边界也一致：真的把指针移出去，要么先点别处让输入框失焦（此后照常收），要么再进再出。
 * 另加一条**输入法组合期**豁免（`compositionstart` ~ `compositionend`）：候选窗弹出时窗口焦点
 * 可能短暂不稳，只靠 `hasFocus()` 会漏；组合期内的 leave 同样不算离开。
 *
 * 不用于：主窗（小条本身要一直在）、便利贴（用户明确要求例外）、设置窗（编辑到一半不能丢）。
 */
import { useEffect } from 'react';
import { WINDOW_LEAVE_HIDE_MS } from '../lib/constants';
import { hideCurrentWindow } from '../lib/window';

/** 焦点是否落在文本控件上（正在打字）。事项窗整窗都是本应用的 UI，不必再限定容器。 */
function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable;
}

export function useWindowLeaveHide(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    if (!root) return;

    let timer: number | null = null;
    /* 必须先「进来过」才允许「离开即隐藏」：窗口刚显示时指针可能并不在它上面，
       pointerleave 会立刻触发，那样窗口一闪就没（用户根本没机会把鼠标移过去）。 */
    let entered = false;
    /* 输入法正在组词（IME 候选窗开着）——这段期间的 leave 同样不算离开 */
    let composing = false;

    const cancel = () => {
      if (timer != null) {
        window.clearTimeout(timer);
        timer = null;
      }
    };

    const arm = () => {
      timer = window.setTimeout(() => {
        timer = null;
        void hideCurrentWindow();
      }, WINDOW_LEAVE_HIDE_MS);
    };

    const onEnter = () => {
      entered = true;
      cancel();
    };

    const onLeave = () => {
      if (!entered) return;
      cancel();
      /* 正在窗里打字时这条 leave 多半是 IME 候选窗/焦点切换带出来的假事件，见文件头注释 */
      if (composing) return;
      if (isTyping() && document.hasFocus()) return;
      arm();
    };

    /* 组词开始：把可能已经起来的隐藏计时撤掉（人明明还在输入） */
    const onCompositionStart = () => {
      composing = true;
      cancel();
    };
    const onCompositionEnd = () => {
      composing = false;
    };

    /* 边缘抖动兜底：`mouseleave` 在部分 WebView2 版本上比 pointer 事件更可靠 */
    root.addEventListener('pointerleave', onLeave);
    root.addEventListener('pointerenter', onEnter);
    root.addEventListener('mouseleave', onLeave);
    root.addEventListener('mouseenter', onEnter);
    /* composition 事件会冒泡，挂在 document 上即可覆盖窗内所有输入框 */
    document.addEventListener('compositionstart', onCompositionStart, true);
    document.addEventListener('compositionend', onCompositionEnd, true);

    return () => {
      cancel();
      root.removeEventListener('pointerleave', onLeave);
      root.removeEventListener('pointerenter', onEnter);
      root.removeEventListener('mouseleave', onLeave);
      root.removeEventListener('mouseenter', onEnter);
      document.removeEventListener('compositionstart', onCompositionStart, true);
      document.removeEventListener('compositionend', onCompositionEnd, true);
    };
  }, [enabled]);
}
