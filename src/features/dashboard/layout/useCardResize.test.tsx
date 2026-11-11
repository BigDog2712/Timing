(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import { useCardResize } from "./useCardResize";
import type { CardId } from "./contract";

/**
 * [可调大小 · 0.12.1 二次修复] 手柄 → 拖动的**接线**判据。
 *
 * 为什么必须有这一层：上一轮修好了 CSS 与纯函数，主人仍报「依然无法拉长」。
 * 纯函数判据只能证明「算得对」，证明不了「拖得动」—— 中间隔着
 * ① 手柄是不是真在卡里、② `closest` 能不能找到卡、③ 拖动有没有先被
 * `pointerdown` 记下起点。这三样任何一处断掉都是**零报错**，表现只有「拖不动」。
 *
 * 仓库没有 `@testing-library`（见 `AddCardDialog.test.tsx` 文件头），照既有做法用
 * `react-dom/client` + `act` 手挂。
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

type ResizeFn = (id: CardId, height: number) => void;

interface Spies {
  onPreview: Mock<ResizeFn>;
  onCommit: Mock<ResizeFn>;
}

/** jsdom 不做布局，`getBoundingClientRect` 恒为 0；拖拽要起步高度，得手工喂一个。 */
function stubHeight(el: Element, height: number) {
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    height,
    top: 0,
    bottom: height,
    left: 0,
    right: 0,
    width: 400,
    x: 0,
    y: 0,
    toJSON: () => ({}),
  } as DOMRect);
}

function mount(tree: ReactElement): Spies {
  const spies: Spies = { onPreview: vi.fn<ResizeFn>(), onCommit: vi.fn<ResizeFn>() };
  function Harness() {
    const { onPointerDown } = useCardResize(spies);
    return createElement("div", { onPointerDown, "data-testid": "board" }, tree);
  }
  act(() => {
    root = createRoot(container!);
    root.render(createElement(Harness));
  });
  return spies;
}

/** 列内卡：`<section class="qp-card" data-card="timer">` 包一个手柄。 */
function columnCard(id: CardId) {
  return createElement(
    "section",
    { className: "qp-card", "data-card": id },
    createElement("span", { className: "qp-card-resize" }),
  );
}

/** [v2] 便利贴：所有卡都套同一个槽 `.qp-card-slot`（没有 `.qp-full-slot` 之分），
 * 卡体本身是 `.qp-notes`。 */
function notesCard(id: CardId) {
  return createElement(
    "div",
    { className: "qp-card-slot", "data-card": id },
    createElement(
      "div",
      { className: "qp-notes" },
      createElement("span", { className: "qp-card-resize" }),
    ),
  );
}

function pointer(target: EventTarget, type: string, clientY: number) {
  act(() => {
    target.dispatchEvent(
      new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientY }),
    );
  });
}

describe("拖拽手柄", () => {
  it("r02a_dragging_the_handle_previews_then_commits_the_delta", () => {
    const spies = mount(columnCard("timer"));
    const card = container!.querySelector(".qp-card") as HTMLElement;
    const handle = container!.querySelector(".qp-card-resize") as HTMLElement;
    stubHeight(card, 288);

    pointer(handle, "pointerdown", 300);
    /* 拖动中：只预览、不落盘（每像素写一次 localStorage 会把手感拖成拉不动） */
    pointer(window, "pointermove", 350);
    expect(spies.onPreview).toHaveBeenCalledWith("timer", 338);
    expect(spies.onCommit).not.toHaveBeenCalled();
    /* 光标是「能拖」的唯一即时反馈 */
    expect(document.body.style.cursor).toBe("ns-resize");

    pointer(window, "pointerup", 400);
    expect(spies.onCommit).toHaveBeenCalledWith("timer", 388);
  });

  it("r02b_pointer_leaving_the_card_keeps_dragging", () => {
    /* 指针移出卡片就断，是「拖到一半突然不动」的经典成因：move/up 必须挂 window。 */
    const spies = mount(columnCard("apps"));
    const card = container!.querySelector(".qp-card") as HTMLElement;
    stubHeight(card, 288);

    pointer(container!.querySelector(".qp-card-resize")!, "pointerdown", 300);
    pointer(document.body, "pointermove", 360);
    expect(spies.onPreview).toHaveBeenCalledWith("apps", 348);
  });

  it("r02c_notes_card_in_its_slot_is_draggable_too", () => {
    /* 便利贴的卡体不是 `.qp-card`：上一版 `closest('.qp-card')` 恒为 null，
     * 手柄明明在、按下去毫无反应。v2 起 `DRAG_TARGET` 包含 `.qp-card-slot`。 */
    const spies = mount(notesCard("notes"));
    const slot = container!.querySelector(".qp-card-slot") as HTMLElement;
    stubHeight(slot, 56);

    pointer(container!.querySelector(".qp-card-resize")!, "pointerdown", 300);
    pointer(window, "pointermove", 340);
    expect(spies.onPreview).toHaveBeenCalledWith("notes", 96);
  });

  it("r02d_pointer_down_outside_a_handle_does_not_start_a_drag", () => {
    const spies = mount(columnCard("todos"));
    const card = container!.querySelector(".qp-card") as HTMLElement;
    stubHeight(card, 288);

    /* 按在卡身（不是手柄）上：不许开始拖，否则点卡内按钮会顺手改高度 */
    pointer(card, "pointerdown", 300);
    pointer(window, "pointermove", 360);
    expect(spies.onPreview).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");
  });
});
