(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import HeatmapModule from "./HeatmapModule.tsx";
import { accumulateHeatmap, buildHeatmapPlan, emptyHeatmapModel } from "../services/heatmapDays.ts";
import type { HeatmapState } from "../hooks/useHeatmapModel.ts";

/**
 * 热力图卡的**行为**判据（分桶、平均、色阶的正确性在 `services/heatmapDays.test.ts`）。
 *
 * 这里只钉三件渲染层的事实：
 *   ① 7 行 × 24 格一个不少，行是**周一→周日**（少一格就是"某几个小时看不见"，且不报错）；
 *   ② 零活动格也是 level 0（看得见的浅底），不是"没有属性" —— 两者在 CSS 里同色，
 *      但语义不同，属性丢了以后没人能验证；
 *   ③ 整张图是 `role="img"` + 一句摘要，格子 `aria-hidden`（168 格逐个念是灾难）。
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

async function mount(element: Parameters<Root["render"]>[0]) {
  /* 语言包没预热就渲染，Provider 会返回 null（空白而不是失败，最难查） */
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
}

const HOUR = 3600_000;
/** 2026-11-12 周四 */
const NOW = new Date(2026, 10, 12, 14, 30).getTime();

function state(records: { startTime: number; endTime: number }[] = []): HeatmapState {
  const plan = buildHeatmapPlan(NOW);
  return { model: accumulateHeatmap(plan, records), status: "ready", retry: () => undefined };
}

/** 有一点数据的模型：空模型走空态，格子根本不渲染（那是 hm23 的判据） */
function seeded(): HeatmapState {
  const plan = buildHeatmapPlan(NOW);
  const thursday = plan.days.at(-1)!;
  return state([{ startTime: thursday.startMs + 9 * HOUR, endTime: thursday.startMs + 10 * HOUR }]);
}

function cells(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(".qp-heatmap__cell") ?? []);
}

describe("活动热力图卡", () => {
  it("hm21_seven_rows_of_twenty_four_cells_labelled_monday_first", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const days = Array.from(container?.querySelectorAll<HTMLElement>(".qp-heatmap__rows > .qp-heatmap__day") ?? []);
    expect(days).toHaveLength(7);
    expect(cells()).toHaveLength(7 * 24);
    /* 第一行是周一：标签走 Intl 的短星期，中文下就是「周一」 */
    expect(days[0].textContent).toContain("一");
    expect(days[6].textContent).toContain("日");
  });

  it("hm22_zero_cells_carry_level_zero_instead_of_no_attribute", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const rowCells = cells();
    /* 周四 9 点是峰值 → level 5；同一行 3 点是零 → level 0 */
    expect(rowCells[3 * 24 + 9].dataset.level).toBe("5");
    expect(rowCells[3 * 24 + 3].dataset.level).toBe("0");
    expect(rowCells.filter((cell) => cell.dataset.level === undefined)).toHaveLength(0);
  });

  it("hm23_no_activity_shows_the_empty_state_and_no_grid", async () => {
    await mount(createElement(HeatmapModule, { state: { model: emptyHeatmapModel(), status: "ready", retry: () => undefined } }));
    expect(container?.querySelector(".qp-heatmap")).toBeNull();
    expect(container?.textContent).toBeTruthy();
  });

  it("hm24_the_grid_is_a_single_labelled_image_with_a_legend_of_five_steps", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const grid = container?.querySelector<HTMLElement>(".qp-heatmap");
    expect(grid?.getAttribute("role")).toBe("img");
    expect(grid?.getAttribute("aria-label") ?? "").toContain("热力图");
    expect(container?.querySelectorAll(".qp-heatmap__legend i")).toHaveLength(5);
    /* 卡头读数照 exe：只写「近 4 周」（`widgets/mod.rs:159`）。
       平均每周那个数没丢 —— 它挪进了 `aria-label`（上一条断言），读屏仍听得到。 */
    expect(container?.querySelector(".qp-card-meta")?.textContent ?? "").toContain("近 4 周");
    expect(grid?.getAttribute("aria-label") ?? "").toContain("平均每周");
  });
});
