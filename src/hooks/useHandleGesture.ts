/**
 * Timing — 手柄手势（单击 / 双击 / 右键 / 中键 / 拖动互斥 / 键盘）
 * -----------------------------------------------------------------------------
 * 为什么不用原生 `dblclick`：它**只对主键**触发，右键双击在 WebView2 里根本拿不到；
 * 而右键恰恰是手柄的默认槽（清单 / 摘要）。所以单击与双击只能**手工配对**：同槽两次
 * tap 间隔 ≤ `DBLCLICK_MS` 即判双击。代价是单击要等这个窗口——所以只在「该手柄有
 * 双击绑定」时才等；两个双击槽全空的手柄当帧派发（0 延迟）。
 *
 * 为什么派发只挂 `click` / `auxclick` / `pointerup(2)`：`.pill` 的 `onClickCapture`
 * 拖完松手时会吞掉**那一次 click**（usePillDrag.ts:26-31），所以"按下就派发"会在拖动
 * 途中误触发；而 `auxclick` / `pointerup` 不被它吞，中键与右键正好靠它们。
 *
 * 回调全部用 ref 取最新值：250ms 的待定单击定时器会**跨渲染存活**，抓着旧闭包就会派发
 * 上一帧的绑定。
 */
import { useCallback, useEffect, useRef } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import { DBLCLICK_MS, DRAG_THRESHOLD_PX } from '../lib/constants';
import type { HandleSlot } from '../lib/handleCatalog';

/** 参与双击配对的只有左右两键（中键不配对） */
type TapSlot = 'left' | 'right';

/**
 * 一次物理右键 = 一次派发。同一物理右键会先 `pointerup(2)` 再 `contextmenu`，
 * 两个入口必须去重（口径沿用被删掉的 NoteHandle.tsx:22 的 400ms）。
 */
const RIGHT_DEDUPE_MS = 400;

export interface HandleGestureConfig {
  /** 该手柄的 5 槽绑定；只用来判断「要不要等 250ms」 */
  slots: Record<HandleSlot, string | null>;
  /** 派发一个槽。空槽 / 未知 id / 护栏不通过一律由 `dispatchHandleAction` 决定 */
  fire: (slot: HandleSlot) => void;
}

export interface HandleGestureHandlers {
  onPointerDown: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: ReactPointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: () => void;
  onMouseDown: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onAuxClick: (event: ReactMouseEvent<HTMLButtonElement>) => void;
  onContextMenu: (event: ReactMouseEvent<HTMLButtonElement>) => void;
}

export function useHandleGesture({ slots, fire }: HandleGestureConfig): HandleGestureHandlers {
  /** 待定的单击（250ms） */
  const singleTimer = useRef<number | null>(null);
  /** 可能成为双击的第一击 */
  const pendingTap = useRef<{ slot: TapSlot; at: number } | null>(null);
  /** 最近一次 `pointerup(2)` 的时刻（contextmenu 去重用） */
  const rightUpAt = useRef(0);
  /** 镜像 usePillDrag 的按下点：同一份坐标、同一个阈值，拖动判定由构造保证等价 */
  const pressOrigin = useRef<{ x: number; y: number } | null>(null);
  /** 本次按下已越过阈值 → 本次手势作废 */
  const dragging = useRef(false);

  const fireRef = useRef(fire);
  const slotsRef = useRef(slots);
  useEffect(() => {
    fireRef.current = fire;
    slotsRef.current = slots;
  });

  const clearPending = useCallback(() => {
    if (singleTimer.current != null) {
      window.clearTimeout(singleTimer.current);
      singleTimer.current = null;
    }
    pendingTap.current = null;
  }, []);

  /** 组件卸载 / 失焦 / 指针取消：本次手势彻底作废（G-04 后半） */
  const reset = useCallback(() => {
    clearPending();
    pressOrigin.current = null;
    dragging.current = false;
  }, [clearPending]);

  const tap = useCallback(
    (slot: TapSlot, at: number) => {
      const current = slotsRef.current;
      const doubleId = slot === 'left' ? current.leftDouble : current.rightDouble;
      const pending = pendingTap.current;

      if (pending && pending.slot === slot && doubleId != null && at - pending.at <= DBLCLICK_MS) {
        /* 第二击落在判定窗内 → 双击。**取消**第一击的定时器，所以单击计数为 0（G-02） */
        clearPending();
        fireRef.current(slot === 'left' ? 'leftDouble' : 'rightDouble');
        return;
      }

      clearPending();
      /* 两个双击槽都空：本手柄没有"双击"这件事，单击不必等（0 延迟，G-03 前半） */
      if (current.leftDouble == null && current.rightDouble == null) {
        fireRef.current(slot);
        return;
      }
      pendingTap.current = { slot, at };
      singleTimer.current = window.setTimeout(() => {
        singleTimer.current = null;
        pendingTap.current = null;
        fireRef.current(slot);
      }, DBLCLICK_MS);
    },
    [clearPending],
  );

  useEffect(() => {
    window.addEventListener('blur', reset);
    return () => {
      window.removeEventListener('blur', reset);
      reset();
    };
  }, [reset]);

  const onPointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button === 2) {
      event.stopPropagation();
      return;
    }
    if (event.button === 1) {
      /* 中键：抑制 WebView2 的自动滚动与中键粘贴。**0 动作** —— 派发只发生在 auxclick */
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    /* button === 0：什么都不做，必须继续冒泡给 `.pill` 的 usePillDrag。
       只记按下点，供拖动互斥判定。 */
    pressOrigin.current = { x: event.screenX, y: event.screenY };
    dragging.current = false;
  }, []);

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      const origin = pressOrigin.current;
      if (!origin) return;
      if ((event.buttons & 1) === 0) {
        /* 松开在按钮外发生：本次按下结束，别再拿旧原点比较 */
        pressOrigin.current = null;
        return;
      }
      if (
        Math.abs(event.screenX - origin.x) < DRAG_THRESHOLD_PX &&
        Math.abs(event.screenY - origin.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      pressOrigin.current = null;
      dragging.current = true;
      /* 拖起来即作废：别让 250ms 的待定单击在拖动中途派发（G-04 + G-06） */
      clearPending();
    },
    [clearPending],
  );

  const onPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button === 2) {
        event.stopPropagation();
        rightUpAt.current = Date.now();
        tap('right', rightUpAt.current);
        return;
      }
      if (event.button === 0) pressOrigin.current = null;
    },
    [tap],
  );

  const onClick = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      /* 键盘（Enter / Space）激活时 detail === 0，鼠标点击恒 ≥ 1。
         键盘没有"双击"这回事 → 立即派发，不走 250ms（H-06）。 */
      if (event.detail === 0) {
        clearPending();
        fireRef.current('left');
        return;
      }
      if (dragging.current) {
        /* 拖动收尾的那一次 click（`.pill` 也会吞，这里再兜一层） */
        dragging.current = false;
        return;
      }
      tap('left', Date.now());
    },
    [clearPending, tap],
  );

  const onAuxClick = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    /* 右键在 Chromium 里同样会派 auxclick(2)，这里只认中键 */
    if (event.button !== 1) return;
    event.preventDefault();
    fireRef.current('middle');
  }, []);

  const onContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLButtonElement>) => {
      event.preventDefault();
      event.stopPropagation();
      /* 同一物理右键：pointerup 已经配对过，这里不再重复派发（G-07） */
      if (Date.now() - rightUpAt.current < RIGHT_DEDUPE_MS) return;
      rightUpAt.current = Date.now();
      tap('right', rightUpAt.current);
    },
    [tap],
  );

  const onPointerCancel = useCallback(() => reset(), [reset]);

  /* button===1 的第二道保险：mousedown 上摘掉 WebView2 的中键自动滚动 */
  const onMouseDown = useCallback((event: ReactMouseEvent<HTMLButtonElement>) => {
    if (event.button === 1) event.preventDefault();
  }, []);

  return {
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onMouseDown,
    onClick,
    onAuxClick,
    onContextMenu,
  };
}
