/**
 * [单独宽度 · 0.12.1] 卡右边缘那条手柄：拖动改**这张卡在自己列里占几格**。
 *
 * 为什么不并进 `useSplitResize`：那根改的是「两列的比例」（一个全局数，换算基准 = 板宽），
 * 这根改的是「一张卡的列内占比」（每卡一个数，换算基准 = **列宽**）。两者都读 `clientX`，
 * 但基准不同 —— 混在一个 hook 里，窄列里拖一下会跳三档，宽列里又纹丝不动。
 *
 * 也不并进 `useCardResize`：那条读 `clientY`、写像素高度，判据盯的是另一件事。
 *
 * 三条手感口径与另两条一致：
 * 1. **拖动中不落盘**（`save = false`），每像素写一次 localStorage 会拖成"拉不动"；
 * 2. move/up 挂 window，指针移出那 12px 缝也能继续拖；
 * 3. 键盘 ←/→ 每次一档（25%），与拖到同一个吸附点走同一条落盘路径。
 */
import { useCallback, useEffect, useRef } from "react";
import { clampCardWidth, MIN_CARD_WIDTH, type CardId } from "./contract";

interface Options {
  onPreview: (id: CardId, width: number) => void;
  onCommit: (id: CardId, width: number) => void;
}

const KEYBOARD_STEP = MIN_CARD_WIDTH;
const HANDLE = ".qp-card-width";
const SLOT = ".qp-card-slot";

interface Drag {
  id: CardId;
  startX: number;
  startWidth: number;
  /** 列的实宽：px → 百分比的换算基准。写死系数会在两个列宽下给出两个手感。 */
  columnWidth: number;
}

export function useCardWidthResize({ onPreview, onCommit }: Options) {
  const dragRef = useRef<Drag | null>(null);
  /** 上一次预览值：吸附到 25 的倍数后，一次拖动里同一档会被算中几十次，不必每像素抬一次 state。 */
  const lastRef = useRef<number | null>(null);

  /** 收尾只清状态：落盘由 `onUp` / 键盘各走各的（同一个 `finish` 里再提交一次会写两遍）。 */
  const finish = useCallback(() => {
    dragRef.current = null;
    lastRef.current = null;
    document.body.style.removeProperty("cursor");
  }, []);

  useEffect(() => {
    const widthAt = (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return null;
      const delta = ((clientX - drag.startX) / Math.max(1, drag.columnWidth)) * 100;
      return clampCardWidth(drag.startWidth + delta);
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
      /* 焦点在手上时以**界面上的值**为起点：它是上一档落盘后的结果，
       * 比从 layout 里再查一遍更不容易和拖动中途的状态打架。 */
      const current = Number(handle.getAttribute("aria-valuenow") ?? MIN_CARD_WIDTH);
      onCommit(id, clampCardWidth(current + (event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP)));
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

  /** 挂在 `.qp-dashboard` 的 onPointerDown 上：只认手柄，不猜坐标。 */
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement | null;
    const handle = target?.closest<HTMLElement>(HANDLE);
    if (!handle) return;
    const slot = handle.closest<HTMLElement>(SLOT);
    const column = slot?.parentElement;
    const id = slot?.dataset.card as CardId | undefined;
    if (!slot || !column || !id) return;

    const columnWidth = column.getBoundingClientRect().width;
    /* jsdom / 未布局时宽度为 0：退回 aria 上的设定值，别让一次除零把起点算成 NaN。 */
    const startWidth = columnWidth > 0
      ? clampCardWidth((slot.getBoundingClientRect().width / columnWidth) * 100)
      : clampCardWidth(Number(handle.getAttribute("aria-valuenow") ?? MIN_CARD_WIDTH));

    dragRef.current = { id, startX: event.clientX, startWidth, columnWidth };
    lastRef.current = startWidth;
    document.body.style.cursor = "col-resize";
    event.preventDefault();
    handle.focus();
  }, []);

  return { onPointerDown };
}
