/**
 * Timing — 「按住空白处拖窗」手势（分析窗自用，[L10] 从 shared/hooks 下沉到 platform/desktop）
 * -----------------------------------------------------------------------------
 * 为什么不是直接复用主窗的 `windows/timing/hooks/useWindowDragAnywhere`：那个经
 * `timing/lib/window` 转出，会把宿主 IPC 全表拖进分析窗 bundle（L9 双窗隔离）。
 * 这里只依赖 `windowControlGateway` 的一条 `startDragging`，两窗零交叉。
 *
 * 为什么归 platform 而不是 shared：它依赖 `platform/desktop/windowControlGateway`（带 invoke），
 * 而 shared 层的规则是「不依赖 platform / features / shell」（L10）。放在 shared 里会形成
 * shared → platform 的反向依赖；放在 platform 里方向朝下，上层（shell / features）照常引。
 *
 * 语义与那个钩子一致，理由也一样：
 *   - 阈值 4px：单击（点按钮、点卡头）照常落到控件上，不被误判成拖动；
 *   - `[data-no-drag]` 子树永不触发；
 *   - Shift + 拖动保留给选中文本；
 *   - 拖动成功后的那次 click 被吞掉，避免松手时误触下面的按钮。
 *
 * 调用方负责「哪里算空白」：标题栏整条（控件除外）、画布背景（卡片除外）。
 */
import { useEffect, useRef } from "react";
import type { MouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { startCurrentWindowDrag } from "./windowControlGateway.ts";

/** 与主窗 `src/lib/constants` 同值：4px 是按"手抖但没想拖"的实测下限定的 */
const DRAG_THRESHOLD_PX = 4;
const DRAG_CLICK_SWALLOW_MS = 240;

export interface WindowDragGesture {
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onClickCapture: (event: MouseEvent<HTMLElement>) => void;
}

export function useWindowDragGesture(): WindowDragGesture {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const swallow = useRef(false);
  const cleanup = useRef<(() => void) | null>(null);

  useEffect(() => () => cleanup.current?.(), []);

  const detach = () => {
    cleanup.current?.();
    cleanup.current = null;
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    /* Shift + 拖动 = 正常选中文本（保命开关，别把选区也拖走） */
    if (event.shiftKey) return;
    const target = event.target;
    if (target instanceof Element && target.closest("[data-no-drag]")) return;

    detach();
    origin.current = { x: event.screenX, y: event.screenY };

    const onMove = (moveEvent: PointerEvent) => {
      const point = origin.current;
      if (!point) return;
      if (
        Math.abs(moveEvent.screenX - point.x) < DRAG_THRESHOLD_PX
        && Math.abs(moveEvent.screenY - point.y) < DRAG_THRESHOLD_PX
      ) {
        return;
      }
      origin.current = null;
      swallow.current = true;
      window.setTimeout(() => {
        swallow.current = false;
      }, DRAG_CLICK_SWALLOW_MS);
      detach();
      void startCurrentWindowDrag().catch(() => undefined);
    };

    const onUp = () => {
      origin.current = null;
      detach();
    };

    window.addEventListener("pointermove", onMove, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onUp, true);
    cleanup.current = () => {
      window.removeEventListener("pointermove", onMove, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onUp, true);
    };
  };

  const onClickCapture = (event: MouseEvent<HTMLElement>) => {
    if (!swallow.current) return;
    swallow.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  return { onPointerDown, onClickCapture };
}
