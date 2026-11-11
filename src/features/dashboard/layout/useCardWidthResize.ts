/**
 * [v2 网格 · 0.12.1末] 卡右边缘手柄：拖动改这张卡的**占宽格数 w（1..COLS）**。
 *
 * 换算基准 = 网格总宽（`.qp-grid`），一格 = 总宽 / COLS。拖多少像素 → 多少格，
 * 吸附到整数。拖动中不落盘（save=false），move/up 挂 window，键盘 ←/→ 每次一格。
 */
import { useCallback, useEffect, useRef } from "react";
import { COLS, type CardId } from "./contract";

interface Options {
  onPreview: (id: CardId, w: number) => void;
  onCommit: (id: CardId, w: number) => void;
}

const HANDLE = ".qp-card-width";
const SLOT = ".qp-card-slot";
const GRID = ".qp-grid";

interface Drag {
  id: CardId;
  startX: number;
  startW: number;
  /** 网格总宽：px → 格数的换算基准。 */
  gridWidth: number;
}

function clampWInt(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.round(Math.min(COLS, Math.max(1, value)));
}

export function useCardWidthResize({ onPreview, onCommit }: Options) {
  const dragRef = useRef<Drag | null>(null);
  const lastRef = useRef<number | null>(null);

  const finish = useCallback(() => {
    dragRef.current = null;
    lastRef.current = null;
    document.body.style.removeProperty("cursor");
  }, []);

  useEffect(() => {
    const widthAt = (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return null;
      const cell = drag.gridWidth / COLS;
      const delta = (clientX - drag.startX) / Math.max(1, cell);
      return clampWInt(drag.startW + delta);
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const next = widthAt(event.clientX);
      if (next === null || next === lastRef.current) return;
      lastRef.current = next;
      onPreview(drag.id, next);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const next = widthAt(event.clientX);
      if (next !== null) onCommit(drag.id, next);
      finish();
    };
    const onCancel = () => finish();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const handle = (document.activeElement as HTMLElement | null)?.closest?.(HANDLE);
      if (!handle) return;
      const slot = handle.closest<HTMLElement>(SLOT);
      const id = slot?.dataset.card as CardId | undefined;
      if (!slot || !id) return;
      event.preventDefault();
      const current = Number(handle.getAttribute("aria-valuenow") ?? 1);
      onCommit(id, clampWInt(current + (event.key === "ArrowRight" ? 1 : -1)));
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

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>(HANDLE);
    if (!handle) return;
    const slot = handle.closest<HTMLElement>(SLOT);
    const grid = slot?.closest<HTMLElement>(GRID);
    const id = slot?.dataset.card as CardId | undefined;
    if (!slot || !grid || !id) return;

    const gridWidth = grid.getBoundingClientRect().width;
    const startW = clampWInt(Number(handle.getAttribute("aria-valuenow") ?? 1));

    dragRef.current = { id, startX: event.clientX, startW, gridWidth };
    lastRef.current = startW;
    document.body.style.cursor = "col-resize";
    event.preventDefault();
    handle.focus();
  }, []);

  return { onPointerDown };
}
