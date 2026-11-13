(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimerModule from "./TimerModule.tsx";

/**
 * V-1.2b：计时分布**空数据仍画底圈**。
 *
 * 为什么要钉：只给一句 `qp-empty` 的空态，"卡是空的还是坏了"分不出来 ——
 * 一圈底环 + 环心读数（今日 0m）说的是"今天真的什么都没记"。回归的坏法是静默的：
 * 有人把 donut 的渲染条件写成 `total > 0`，空卡立刻退化成一行字，没有任何报错。
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

async function mount() {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimerModule, {
        categoryDist: [],
        dimension: "category",
        onDimensionChange: () => undefined,
        totalTrackedTime: 0,
        dayDeltaTrackedTime: 0,
        status: "ready",
        refreshError: false,
        onRetry: () => undefined,
      }),
    }));
  });
}

describe("计时分布卡 · 空数据（V-1.2b）", () => {
  it("te01_empty_state_still_draws_the_base_ring", async () => {
    const errors: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => { errors.push(args); };
    try {
      await mount();
    } finally {
      console.error = original;
    }

    /* 四态是 empty（不是骨架、不是错误块） */
    const card = container?.querySelector<HTMLElement>(".qp-card");
    expect(card?.getAttribute("data-state")).toBe("empty");
    /* 空态文案在，但**不只**是文案：底环还在 */
    expect(container?.querySelector(".qp-empty")).not.toBeNull();
    const donut = container?.querySelector(".qp-donut");
    expect(donut).not.toBeNull();
    /* 底圈 = 一根轨道色 circle（`stroke=var(--qp-track-muted)`），环心读数是"今日 0m" */
    expect(donut?.querySelector("svg circle")).not.toBeNull();
    expect(donut?.querySelector(".qp-donut-total")?.textContent).toBe("0m");
    /* 渲染零报错：空态分支走的是同一份 donut JSX，不该有 React 警告 */
    expect(errors).toHaveLength(0);
  });
});
