(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useCardDrag } from "./useCardDrag";
import type { CardId } from "./contract";

/**
 * [拖拽排序 · 0.12.1末] 卡头 grip → 拖动的**接线**判据。
 *
 * 与 `useCardResize.test.tsx` 同一个理由：`gridFlow.ts` 证明「算得对」，证明不了
 * 「拖得动」。中间隔着三件事，任何一处断掉都是零报错、只有「拖了没反应」：
 *   ① grip 是否在卡头里（`.qp-card-grip` 在 `.qp-card-slot` 内）；
 *   ② 换算基准是**网格矩形**（`.qp-grid`）的列宽/行高；
 *   ③ `pointerdown` 有没有先记下起点。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  container?.remove();
  container = null;
  document.body.style.removeProperty("cursor");
});

type DropFn = (id: CardId, col: number, row: number) => void;

function stubRect(el: Element, rect: Partial<DOMRect>) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width: 400, height: 264, top: 0, bottom: 264, left: 0, right: 400, x: 0, y: 0,
    ...rect,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount(): { onPreview: Mock<DropFn>; onCommit: Mock<DropFn> } {
  const spies = { onPreview: vi.fn<DropFn>(), onCommit: vi.fn<DropFn>() };
  function Harness() {
    const { onPointerDown } = useCardDrag(spies);
    return createElement(
      "div",
      { onPointerDown },
      createElement(
        "div",
        { className: "qp-grid" },
        createElement(
          "div",
          { className: "qp-card-slot", "data-card": "timer" },
          createElement("span", { className: "qp-card-grip" }),
        ),
      ),
    );
  }
  act(() => {
    root = createRoot(container!);
    root.render(createElement(Harness));
  });
  return spies;
}

function pointer(target: EventTarget, type: string, clientX: number, clientY: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX, clientY }),
    );
  });
}

describe("卡头拖拽手柄（网格 v2）", () => {
  it("d01a_dragging_grip_previews_the_target_cell_then_commits", () => {
    const spies = mount();
    const grid = container!.querySelector<HTMLElement>(".qp-grid")!;
    const slot = container!.querySelector<HTMLElement>(".qp-card-slot")!;
    stubRect(grid, { width: 400, height: 528 });
    stubRect(slot, { height: 264 });

    const grip = container!.querySelector(".qp-card-grip")!;
    pointer(grip, "pointerdown", 50, 50);
    /* 网格 400 宽 4 列 → 100 一格；行高 264。拖到 (250, 300) = col2 row1。 */
    pointer(window, "pointermove", 250, 300);
    expect(spies.onPreview).toHaveBeenCalledWith("timer", 2, 1);
    expect(spies.onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("grabbing");

    pointer(window, "pointerup", 250, 300);
    expect(spies.onCommit).toHaveBeenCalledWith("timer", 2, 1);
    expect(document.body.style.cursor).toBe("");
  });

  it("d01b_pointer_leaving_the_grip_keeps_dragging", () => {
    const spies = mount();
    const grid = container!.querySelector<HTMLElement>(".qp-grid")!;
    const slot = container!.querySelector<HTMLElement>(".qp-card-slot")!;
    stubRect(grid, { width: 400 });
    stubRect(slot, { height: 264 });

    pointer(container!.querySelector(".qp-card-grip")!, "pointerdown", 50, 50);
    pointer(document.body, "pointermove", 150, 300);
    expect(spies.onPreview).toHaveBeenCalledWith("timer", 1, 1);
  });

  it("d01c_pointer_down_outside_the_grip_does_not_start_a_drag", () => {
    const spies = mount();
    const grid = container!.querySelector<HTMLElement>(".qp-grid")!;
    const slot = container!.querySelector<HTMLElement>(".qp-card-slot")!;
    stubRect(grid, { width: 400 });
    stubRect(slot, { height: 264 });

    pointer(slot, "pointerdown", 50, 50);
    pointer(window, "pointermove", 150, 300);
    expect(spies.onPreview).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });

  it("d01d_dragging_id_is_exposed_during_drag_and_cleared_on_drop", () => {
    /* draggingId 是卡体 `data-dragging` 的视觉源：拖动中非空、松手清空。 */
    let draggingId: CardId | null = "timer";
    function Harness() {
      const result = useCardDrag({ onPreview: () => {}, onCommit: () => {} });
      draggingId = result.draggingId;
      return createElement(
        "div",
        { onPointerDown: result.onPointerDown },
        createElement(
          "div",
          { className: "qp-grid" },
          createElement(
            "div",
            { className: "qp-card-slot", "data-card": "timer" },
            createElement("span", { className: "qp-card-grip" }),
          ),
        ),
      );
    }
    act(() => {
      root = createRoot(container!);
      root.render(createElement(Harness));
    });
    const grid = container!.querySelector<HTMLElement>(".qp-grid")!;
    const slot = container!.querySelector<HTMLElement>(".qp-card-slot")!;
    stubRect(grid, { width: 400 });
    stubRect(slot, { height: 264 });

    expect(draggingId).toBeNull();
    pointer(container!.querySelector(".qp-card-grip")!, "pointerdown", 50, 50);
    expect(draggingId).toBe("timer");
    pointer(window, "pointerup", 150, 300);
    expect(draggingId).toBeNull();
  });
});
