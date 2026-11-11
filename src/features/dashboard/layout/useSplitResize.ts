/**
 * [列宽比可拖 · 0.12.1] 两列之间那根分隔条的拖拽。
 *
 * 为什么单开一个 hook：`useCardResize` 改的是**卡的高度**（读 `clientY`、写 `px`），
 * 这里改的是**列的比例**（读 `clientX`、写 fr 权重）。两者的换算、上限、落盘时机
 * 都不一样，塞进同一个 hook 只会让两边的判据互相污染。
 *
 * 三条口径：
 * 1. **px → fr 的换算是按容器宽实时算的**，不写死系数：窗口 1100 与 900 下同一段像素
 *    对应的比例不同，写死会让窄窗拖一格跳一大截。
 * 2. **拖动中不落盘**（`save = false`）：每像素写一次 localStorage 会把手感拖成"拉不动"。
 * 3. window 上挂 move/up：指针移出那条 8px 窄缝也能继续拖，否则一离开就断。
 */
import { useCallback, useEffect, useRef } from "react";
import { SPLIT_TOTAL, clampSplit } from "./contract";

interface Options {
  /** 当前左列 fr 权重（拖动起点） */
  split: number;
  onPreview: (split: number) => void;
  onCommit: (split: number) => void;
}

const KEYBOARD_STEP = 2;

export function useSplitResize({ split, onPreview, onCommit }: Options) {
  const dragRef = useRef<{ startX: number; startSplit: number; boardWidth: number } | null>(null);
  /* 拖动中要读最新的起点，但 window 监听只挂一次 —— 用 ref 镜像，避免每次 split 变化重挂监听 */
  const splitRef = useRef(split);
  splitRef.current = split;

  const finish = useCallback((ratioDelta?: number) => {
    const drag = dragRef.current;
    dragRef.current = null;
    document.body.style.removeProperty("cursor");
    if (!drag) return;
    if (typeof ratioDelta === "number") onCommit(drag.startSplit + ratioDelta);
  }, [onCommit]);

  useEffect(() => {
    const deltaOf = (clientX: number) => {
      const drag = dragRef.current;
      if (!drag) return 0;
      /* fr 权重总和固定 98，横向铺满板宽：一像素 = SPLIT_TOTAL / 板宽 个 fr */
      return ((clientX - drag.startX) / Math.max(1, drag.boardWidth)) * SPLIT_TOTAL;
    };
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      event.preventDefault();
      onPreview(drag.startSplit + deltaOf(event.clientX));
    };
    const onUp = (event: PointerEvent) => {
      if (!dragRef.current) return;
      finish(deltaOf(event.clientX));
    };
    const onCancel = () => finish();
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
      const handle = (document.activeElement as HTMLElement | null)?.closest?.(".qp-split");
      if (!handle) return;
      event.preventDefault();
      const next = splitRef.current + (event.key === "ArrowRight" ? KEYBOARD_STEP : -KEYBOARD_STEP);
      onCommit(clampSplit(next));
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
    /* 板宽取分隔条的父节点：分隔条自己只有 8px 宽，拿它算换算系数会放大十几倍 */
    const board = event.currentTarget.parentElement;
    if (!board) return;
    dragRef.current = {
      startX: event.clientX,
      startSplit: splitRef.current,
      boardWidth: board.getBoundingClientRect().width,
    };
    document.body.style.cursor = "col-resize";
    event.preventDefault();
    event.currentTarget.focus();
  }, []);

  return { onPointerDown };
}
