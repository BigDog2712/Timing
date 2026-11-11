(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useCardWidthResize } from "./useCardWidthResize";
import { COLS, type CardId } from "./contract";

/**
 * [v2 · 0.12.1末] 卡宽手柄 → 拖动的**接线**判据。
 *
 * 与 `useCardResize.test.tsx` 同一个理由：纯函数证明「算得对」，证明不了「拖得动」。
 * 中间隔着三件事，任何一处断掉都是零报错、只有「拖了没变化」：
 *   ① 手柄是否真在槽里（`.qp-card-width` 在 `.qp-card-slot` 内）；
 *   ② 换算基准是**网格总宽**（`.qp-grid`）而不是别的容器（取错会让窄网格里拖一下跳多档）；
 *   ③ `pointerdown` 有没有先记下起点。
 *
 * v2 起宽度是**整数格 w**（1..COLS），不再是百分比：一格 = 网格总宽 / COLS，
 * 拖动的像素增量换算成格数并吸附到整数。
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

type ResizeFn = (id: CardId, w: number) => void;

function stubWidth(el: Element, width: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    width,
    height: 0,
    top: 0,
    bottom: 0,
    left: 0,
    right: width,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount(): { onPreview: Mock<ResizeFn>; onCommit: Mock<ResizeFn> } {
  const spies = { onPreview: vi.fn<ResizeFn>(), onCommit: vi.fn<ResizeFn>() };
  function Harness() {
    const { onPointerDown } = useCardWidthResize(spies);
    return createElement(
      "div",
      { onPointerDown },
      createElement(
        "div",
        { className: "qp-grid" },
        createElement(
          "div",
          { className: "qp-card-slot", "data-card": "timer", "data-tier": "M" },
          createElement("section", { className: "qp-card" }),
          createElement("span", { className: "qp-card-width", "aria-valuenow": 1, tabIndex: 0 }),
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

/** 网格总宽 400、卡当前占 1 格（400/4 = 100px 一格）：往右拖 100px 正好 +1 格。 */
function layout400() {
  const grid = container!.querySelector<HTMLElement>(".qp-grid")!;
  stubWidth(grid, 400);
}

function pointer(target: EventTarget, type: string, clientX: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX }),
    );
  });
}

describe("卡宽手柄（网格 v2）", () => {
  it("w03a_dragging_the_handle_previews_the_snapped_grid_step_then_commits", () => {
    const spies = mount();
    layout400();
    const handle = container!.querySelector(".qp-card-width")!;

    pointer(handle, "pointerdown", 200);
    /* +90px = +0.9 格，必须**吸附**到 2 格：不吸附就会存下 1.9 这种小数，
     * 卡片宽度从此和四等分的网格对不齐，且下一次拖动的起点也跟着歪。 */
    pointer(window, "pointermove", 290);
    expect(spies.onPreview).toHaveBeenCalledWith("timer", 2);
    expect(spies.onCommit).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("col-resize");

    pointer(window, "pointerup", 290);
    expect(spies.onCommit).toHaveBeenCalledWith("timer", 2);
  });

  it("w03b_dragging_past_the_edge_clamps_at_the_full_grid_width", () => {
    const spies = mount();
    layout400();

    pointer(container!.querySelector(".qp-card-width")!, "pointerdown", 200);
    pointer(window, "pointermove", 900);
    expect(spies.onPreview).toHaveBeenLastCalledWith("timer", COLS);
  });

  it("w03c_pointer_leaving_the_handle_keeps_dragging", () => {
    /* move/up 必须挂 window：挂在手柄上，指针一离开那 12px 缝就断，症状是「拖到一半不动」 */
    const spies = mount();
    layout400();

    pointer(container!.querySelector(".qp-card-width")!, "pointerdown", 200);
    pointer(document.body, "pointermove", 260);
    expect(spies.onPreview).toHaveBeenCalledWith("timer", 2);
  });

  it("w03d_pointer_down_outside_the_handle_does_not_start_a_drag", () => {
    const spies = mount();
    layout400();

    /* 按在卡身上：不许开始拖，否则点卡里的按钮会顺手改宽度 */
    pointer(container!.querySelector(".qp-card")!, "pointerdown", 200);
    pointer(document.body, "pointermove", 300);
    expect(spies.onPreview).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });

  it("w03e_keyboard_arrows_step_one_grid_at_a_time", () => {
    const spies = mount();
    layout400();
    const handle = container!.querySelector<HTMLElement>(".qp-card-width")!;
    act(() => handle.focus());

    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    expect(spies.onCommit).toHaveBeenCalledWith("timer", 2);
  });
});
