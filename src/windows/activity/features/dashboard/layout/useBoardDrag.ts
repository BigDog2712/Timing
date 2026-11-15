/**
 * [v3] 拖拽与缩放：**一块画布，三种抓取**（整卡移动 / 右缘改宽 / 下缘改高 / 右下角同时改）。
 *
 * 三段手感（沿用 v2 已验证的那三条纪律）：
 * 1. **拖动中不落盘**（`save=false`）：每帧写 localStorage 会把手感拖成拉不动；
 * 2. window 上挂 move/up：指针快速移出卡片也能继续拖，不会「拖一半掉了」；
 * 3. 位移除以 `zoom`：画布是等比缩放的，不换算的话窗口缩小后拖 1px 只走 0.7px，
 *    表现为「拖不动 / 跟不上指针」。
 *
 * 吸附交给 `clampRect`（`layout.snap` 决定 8px 还是 1px），这里不做第二套取整 ——
 * 两套取整叠在一起会出现「松手后弹回两格」。
 */
import { useCallback, useEffect, useRef } from "react";
import type { Rect } from "./contract";

export type DragMode = "move" | "e" | "s" | "se";

interface Options {
  onPreview: (uid: number, rect: Rect) => void;
  onCommit: (uid: number, rect: Rect) => void;
  /** 按下即把卡提到最前（被压住的卡露一角也能点回来）。 */
  onRaise?: (uid: number) => void;
}

interface DragState {
  uid: number;
  mode: DragMode;
  start: Rect;
  pointer: { x: number; y: number };
  zoom: number;
  last: Rect;
}

const CURSOR: Record<DragMode, string> = {
  move: "grabbing",
  e: "ew-resize",
  s: "ns-resize",
  se: "nwse-resize",
};

export function useBoardDrag({ onPreview, onCommit, onRaise }: Options) {
  const dragRef = useRef<DragState | null>(null);

  const finish = useCallback((commit: boolean) => {
    const drag = dragRef.current;
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    if (commit && drag) onCommit(drag.uid, drag.last);
  }, [onCommit]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const dx = (event.clientX - drag.pointer.x) / drag.zoom;
      const dy = (event.clientY - drag.pointer.y) / drag.zoom;
      const next: Rect = { ...drag.start };
      if (drag.mode === "move") {
        next.x = drag.start.x + dx;
        next.y = drag.start.y + dy;
      }
      if (drag.mode === "e" || drag.mode === "se") next.w = drag.start.w + dx;
      if (drag.mode === "s" || drag.mode === "se") next.h = drag.start.h + dy;
      if (
        next.x === drag.last.x && next.y === drag.last.y
        && next.w === drag.last.w && next.h === drag.last.h
      ) return;
      drag.last = next;
      onPreview(drag.uid, next);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [finish, onPreview]);

  const begin = useCallback((
    event: React.PointerEvent<HTMLElement>,
    uid: number,
    rect: Rect,
    mode: DragMode,
    zoom: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    onRaise?.(uid);
    dragRef.current = {
      uid,
      mode,
      start: { ...rect },
      pointer: { x: event.clientX, y: event.clientY },
      zoom: zoom > 0 ? zoom : 1,
      last: { ...rect },
    };
    document.body.style.cursor = CURSOR[mode];
    document.body.style.userSelect = "none";
  }, [onRaise]);

  return { begin };
}
