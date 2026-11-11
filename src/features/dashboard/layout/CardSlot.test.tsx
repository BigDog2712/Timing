(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import CardSlot from "./CardSlot.tsx";
import { COLS, type LayoutCard } from "./contract";

/**
 * [v2 · 0.12.1末] 卡槽的**接线**判据：grid-column/grid-row 定位必须落在槽上，
 * 宽度手柄挂在槽右缘、带当前占宽值。断一处都是零报错（拖不动 / 拖了没变化）。
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
  return { id: "timer", x: 0, w: 1, h: 1, tier: "M", ...overrides };
}

const slotOf = () => container!.querySelector<HTMLElement>(".qp-card-slot")!;

describe("卡槽（网格 v2）", () => {
  it("x/w 定位成 grid-column，h 定位成 grid-row", async () => {
    await mount(createElement(CardSlot, { card: card({ x: 1, w: 2, h: 2 }), children: null }));
    const style = slotOf().getAttribute("style") ?? "";
    expect(style).toContain("grid-column: 2 / span 2");
    expect(style).toContain("grid-row: span 2");
    expect(slotOf().dataset.card).toBe("timer");
    expect(slotOf().dataset.tier).toBe("M");
    expect(slotOf().dataset.h).toBe("2");
    expect(slotOf().dataset.w).toBe("2");
  });

  it("缺省 x=0 w=1 h=1 占一个基准格", async () => {
    await mount(createElement(CardSlot, { card: card(), children: null }));
    const style = slotOf().getAttribute("style") ?? "";
    expect(style).toContain("grid-column: 1 / span 1");
    expect(style).toContain("grid-row: span 1");
  });

  it("宽度手柄挂载、带当前占宽与 [1,COLS] 范围", async () => {
    await mount(createElement(CardSlot, { card: card({ w: 3 }), children: null }));
    const handle = container!.querySelector<HTMLElement>(".qp-card-width");
    expect(handle).not.toBeNull();
    expect(handle!.getAttribute("aria-valuenow")).toBe("3");
    expect(handle!.getAttribute("aria-valuemin")).toBe("1");
    expect(handle!.getAttribute("aria-valuemax")).toBe(String(COLS));
    expect(handle!.tabIndex).toBe(0);
  });
});
