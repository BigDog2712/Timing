/**
 * [拖拽排序 · 0.12.1末] 卡头拖拽重排：安卓桌面小组件式的「让位」行为。
 *
 * 为什么是「卡头整条」而不是「右下角一个小手柄」：小组件桌面的心智是「按住卡片
 * 拖到哪儿就落哪儿」，抓取热区 = 卡头（`.qp-card-head`），上面已有 grip 六点阵做
 * 静息线索（`.qp-card-grip`）。`⋯` 菜单与右槽里的按钮不在卡头抓取热区里 ——
 * 它们各自的 onPointerDown 会 `stopPropagation`，不会误触发拖拽。
 *
 * 三段手感：
 * 1. **拖动中不落盘**（save=false）：每帧写 localStorage 会把手感拖成拉不动。
 * 2. window 上挂 move/up：指针快速移出卡也能继续拖。
 * 3. 目标格由网格矩形反推：`col = floor(px / cellW)`、`row = floor(py / rowH)`，
 *    吸附到整数格，交给 `repositionCard` 做 dense 让位。
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { COLS, type CardId } from "./contract";

interface Options {
  onPreview: (id: CardId, col: number, row: number) => void;
  onCommit: (id: CardId, col: number, row: number) => void;
}

const GRIP = ".qp-card-grip";
const SLOT = ".qp-card-slot";
const GRID = ".qp-grid";

interface Drag {
  id: CardId;
  /** 网格矩形：px → 格/行 的换算基准。 */
  left: number;
  top: number;
  cellW: number;
  rowH: number;
}

function clampInt(value: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  /* floor 而不是 round：指针在格内（0..cellW）就属于这格，`round` 会在半格处跳到下一格，
   * 导致「拖到格子边缘」时目标格比眼睛看到的偏右一格。 */
  return Math.floor(Math.min(max, Math.max(0, value)));
}

export function useCardDrag({ onPreview, onCommit }: Options) {
  const dragRef = useRef<Drag | null>(null);
  const lastRef = useRef<{ col: number; row: number } | null>(null);
  /** 正在拖的卡 id：供卡体加 `data-dragging`（grip 拉满 + 阴影抬升的视觉源）。 */
  const [draggingId, setDraggingId] = useState<CardId | null>(null);

  const finish = useCallback(() => {
    dragRef.current = null;
    lastRef.current = null;
    setDraggingId(null);
    document.body.style.removeProperty("cursor");
  }, []);

  useEffect(() => {
    const cellAt = (clientX: number, clientY: number) => {
      const drag = dragRef.current;
      if (!drag) return null;
      const col = clampInt((clientX - drag.left) / Math.max(1, drag.cellW), COLS - 1);
      const row = clampInt((clientY - drag.top) / Math.max(1, drag.rowH), 999);
      return { col, row };
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      const cell = cellAt(event.clientX, event.clientY);
      if (!cell) return;
      if (lastRef.current && lastRef.current.col === cell.col && lastRef.current.row === cell.row) return;
      lastRef.current = cell;
      onPreview(drag.id, cell.col, cell.row);
    };
    const onUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      const cell = cellAt(event.clientX, event.clientY);
      if (cell) onCommit(drag.id, cell.col, cell.row);
      finish();
    };
    const onCancel = () => finish();

    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
    };
  }, [finish, onPreview, onCommit]);

  /** 挂在 `.qp-dashboard` 容器的 onPointerDown 上：只认卡头 grip，不猜坐标。 */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const grip = target?.closest<HTMLElement>(GRIP);
    if (!grip) return;
    const slot = grip.closest<HTMLElement>(SLOT);
    const grid = slot?.closest<HTMLElement>(GRID);
    const id = slot?.dataset.card as CardId | undefined;
    if (!slot || !grid || !id) return;

    const rect = grid.getBoundingClientRect();
    const cellW = rect.width / COLS;
    /* 行高 = 网格的行高；取首行实际高度，兜底 264（jsdom 无布局时） */
    const firstRow = grid.querySelector<HTMLElement>(SLOT);
    const rowH = firstRow ? firstRow.getBoundingClientRect().height : 264;
    dragRef.current = {
      id,
      left: rect.left,
      top: rect.top,
      cellW,
      rowH: rowH > 0 ? rowH : 264,
    };
    lastRef.current = null;
    setDraggingId(id);
    document.body.style.cursor = "grabbing";
    event.preventDefault();
  }, []);

  return { onPointerDown, draggingId };
}
