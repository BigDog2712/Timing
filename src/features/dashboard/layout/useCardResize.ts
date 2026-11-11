/**
 * [拖拽调整大小 · 0.12.1] 卡片下边缘的**显式手柄**拖动改变高度。
 *
 * 为什么从「几何猜测」改成「显式手柄」：上一版靠 `event.clientY >= rect.bottom - 8`
 * 判断是不是在卡的下边缘，用户报「图窗大小也没办法调整」—— 靠坐标猜的命中最容易失效
 * （卡内滚动容器、伪元素、DPR 都能让它差几像素）。现在卡底有一条真的手柄元素
 * （`.qp-card-resize`，由 `ModuleShell` 渲染），按下它就是拖，不再猜。
 *
 * 三件手感上的事：
 * 1. **拖动中不落盘**（`save=false`）：每像素写一次 localStorage 会把手感拖成"拉不动"。
 * 2. window 上挂 move/up：指针快速移出卡片也能继续拖，否则一离开卡就断。
 * 3. 键盘等价：手柄可 Tab 聚焦，↑/↓ 每次 ±8px 并立刻落盘（同一条路径，不另写一套）。
 */
import { useCallback, useEffect, useRef } from "react";
import type { CardId } from "./contract";

interface Options {
  onPreview: (id: CardId, height: number) => void;
  onCommit: (id: CardId, height: number) => void;
}

const KEYBOARD_STEP = 8;

/**
 * 拖拽目标的**唯一**选择器。
 *
 * [v2] 所有卡都套 `.qp-card-slot`（网格槽），没有 `.qp-full-slot` 之分。
 * 便利贴的卡体是 `.qp-notes`，但它的槽也是 `.qp-card-slot`，`closest` 能命中。
 */
const DRAG_TARGET = ".qp-card, .qp-card-slot";

function cardIdOf(card: HTMLElement | null): CardId | null {
  if (!card) return null;
  const fromControls = card.querySelector<HTMLElement>("[data-card-controls]")?.dataset.cardControls;
  if (fromControls) return fromControls as CardId;
  const fromCard = card.dataset.card;
  return fromCard ? (fromCard as CardId) : null;
}

export function useCardResize({ onPreview, onCommit }: Options) {
  const dragRef = useRef<{ id: CardId; startY: number; startHeight: number } | null>(null);

  const finish = useCallback((height?: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    if (drag && typeof height === "number") onCommit(drag.id, height);
  }, [onCommit]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      onPreview(drag.id, drag.startHeight + (event.clientY - drag.startY));
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      finish(drag.startHeight + (event.clientY - drag.startY));
    };
    const onCancel = () => finish();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
      const handle = (document.activeElement as HTMLElement | null)?.closest?.(".qp-card-resize");
      if (!handle) return;
      const card = handle.closest<HTMLElement>(DRAG_TARGET);
      const id = cardIdOf(card);
      if (!card || !id) return;
      event.preventDefault();
      const next = card.getBoundingClientRect().height + (event.key === "ArrowDown" ? KEYBOARD_STEP : -KEYBOARD_STEP);
      onCommit(id, next);
    };

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, [finish, onPreview, onCommit]);

  /** 挂在 `.qp-dashboard` 容器的 onPointerDown 上：只认手柄，不猜坐标。 */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>(".qp-card-resize");
    if (!handle) return;
    const card = handle.closest<HTMLElement>(DRAG_TARGET);
    const id = cardIdOf(card);
    if (!card || !id) return;

    dragRef.current = { id, startY: event.clientY, startHeight: card.getBoundingClientRect().height };
    document.body.style.cursor = "ns-resize";
    event.preventDefault();
    handle.focus();
  }, []);

  return { onPointerDown };
}
