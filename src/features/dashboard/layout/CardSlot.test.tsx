(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import CardSlot from "./CardSlot.tsx";
import type { LayoutCard } from "./contract";

/**
 * [单独宽度 · 0.12.1] 卡槽的**接线**判据（不是算式）。
 *
 * 纯函数只能证明「span 算得对」，证明不了它有没有真的写进样式、手柄有没有挂上去。
 * 这三样任何一处断掉都是零报错，用户只看到「拖不动 / 拖了没变化」：
 *   ① `grid-column: span N` 必须落在槽上（写在卡上会被通栏路径一起带走）；
 *   ② 拖出来的高度必须是**固定 px**，不许被 `minmax(0, …)` 包起来（那个 0 下限
 *      会让 grid 在容器不足时把它压回去 —— 实测拖 480 而卡恒 282）；
 *   ③ 通栏槽不许出宽度手柄（它本来就是整板宽，给个拖不动的键是假选择）。
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

async function mount(node: ReactNode) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: node })));
}

function card(overrides: Partial<LayoutCard> = {}): LayoutCard {
  return { id: "timer", column: "left", tier: "M", ...overrides };
}

const slotOf = () => container!.querySelector<HTMLElement>(".qp-card-slot, .qp-full-slot")!;

describe("卡槽", () => {
  it("w02a_width_becomes_a_column_span_on_the_slot", async () => {
    await mount(createElement(CardSlot, { card: card({ width: 50 }), mode: "column", children: null }));
    expect(slotOf().getAttribute("style") ?? "").toContain("span 2");
    expect(slotOf().dataset.card).toBe("timer");
    expect(slotOf().dataset.tier).toBe("M");
  });

  it("w02b_default_width_spans_the_whole_column", async () => {
    await mount(createElement(CardSlot, { card: card(), mode: "column", children: null }));
    /* 缺省 = 占满 4 格：老布局（没有 width 键）读出来必须还是今天的样子 */
    expect(slotOf().getAttribute("style") ?? "").toContain("span 4");
  });

  it("w02c_dragged_height_is_a_fixed_value_not_a_suggestion", async () => {
    await mount(createElement(CardSlot, { card: card({ height: 480 }), mode: "column", children: null }));
    const style = slotOf().getAttribute("style") ?? "";
    expect(style).toContain("height: 480px");
    expect(style).not.toContain("minmax");
  });

  it("w02d_width_handle_is_mounted_and_tagged_with_the_current_value", async () => {
    await mount(createElement(CardSlot, { card: card({ width: 25 }), mode: "column", children: null }));
    const handle = container!.querySelector<HTMLElement>(".qp-card-width");
    expect(handle).not.toBeNull();
    /* 键盘 ←/→ 与读屏都靠这三个数；缺了 aria-valuenow，按一下方向键会从 25 跳回 50 */
    expect(handle!.getAttribute("aria-valuenow")).toBe("25");
    expect(handle!.getAttribute("aria-valuemin")).toBe("25");
    expect(handle!.getAttribute("aria-valuemax")).toBe("100");
    expect(handle!.tabIndex).toBe(0);
  });

  it("w02e_full_slot_has_no_width_handle", async () => {
    await mount(createElement(CardSlot, { card: card({ id: "notes", column: "full", width: 50 }), mode: "full", children: null }));
    expect(container!.querySelector(".qp-full-slot")).not.toBeNull();
    expect(container!.querySelector(".qp-card-width")).toBeNull();
  });
});
