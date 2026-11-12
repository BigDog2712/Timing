(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AddCardDialog from "./AddCardDialog";
import { BOARD_COPY } from "./boardCopy";
import { CARD_IDS, type CardKind } from "./contract";

/**
 * [v3] 加卡弹层的行为判据。与 v2 的差别就是这一轮的功能变化本身：
 *   ① **不去重**——同一种组件加两张时，第二张的入口不许变灰；
 *   ② **不自动关闭**——加完还能接着加。
 * 这两条改回去不会报错，只会某天被报「我想放两张待办，结果第一次点完弹层就没了」。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(element: Parameters<Root["render"]>[0]) {
  act(() => root?.render(element));
}

function items(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-add-card__item") ?? []);
}

describe("AddCardDialog（v3）", () => {
  it("列出全部组件，已在板上的也照样可点", () => {
    const onAdd = vi.fn();
    mount(createElement(AddCardDialog, {
      copy: BOARD_COPY["zh-CN"],
      countOf: () => 2,
      onAdd,
      onClose: () => undefined,
    }));
    expect(items().length).toBe(CARD_IDS.length);
    const first = items()[0];
    expect(first.disabled).toBe(false);
    act(() => first.click());
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onAdd).toHaveBeenCalledWith(CARD_IDS[0]);
  });

  it("加完不关闭弹层（可以连着加第二张）", () => {
    const onClose = vi.fn();
    mount(createElement(AddCardDialog, {
      copy: BOARD_COPY["zh-CN"],
      countOf: () => 1,
      onAdd: (_kind: CardKind) => undefined,
      onClose,
    }));
    act(() => items()[0].click());
    act(() => items()[0].click());
    expect(onClose).not.toHaveBeenCalled();
    expect(items().length).toBe(CARD_IDS.length);
  });

  it("显示「板上 N 张」，并响应 Esc 关闭", () => {
    const onClose = vi.fn();
    mount(createElement(AddCardDialog, {
      copy: BOARD_COPY["zh-CN"],
      countOf: (kind) => (kind === "todos" ? 3 : 0),
      onAdd: () => undefined,
      onClose,
    }));
    const text = container?.textContent ?? "";
    expect(text).toContain("板上 3 张");
    act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });
    expect(onClose).toHaveBeenCalled();
  });
});
