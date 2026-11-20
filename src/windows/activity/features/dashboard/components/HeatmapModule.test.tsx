(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import HeatmapModule from "./HeatmapModule.tsx";
import { accumulateHeatmap, buildHeatmapPlan, emptyHeatmapModel } from "../services/heatmapDays.ts";
import type { HeatmapState } from "../hooks/useHeatmapModel.ts";

/**
 * 热力图卡的**行为**判据（分桶、裁剪、色阶的正确性在 `services/heatmapDays.test.ts`）。
 *
 * 这里只钉渲染层的事实：
 *   ① 纵轴第一行「day」+ 6 个时段起点，横轴是整月每一天（少一天就是"某一天看不见"，且不报错）；
 *   ② 零活动格是 level 0、今天还没到的段与未来的天是 `data-future`（"还没到"与"没干活"必须分开）；
 *   ③ 横轴日期只每 5 天标一次（1、5、10…），其余数字留空；
 *   ④ 整张图是 `role="img"` + 一句摘要，格子不再逐个念；
 *   ⑤ 月导航：上一月可点、当前月不许再往未来翻。
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
/** 2026-11-12 周四 14:30（整月 30 列都铺满；今天 16 点以后的段还没到） */
const NOW = new Date(2026, 10, 12, 14, 30).getTime();

function makeState(
  records: { startTime: number; endTime: number }[] = [],
  overrides: Partial<HeatmapState> = {},
): HeatmapState {
  const plan = buildHeatmapPlan(NOW);
  return {
    model: accumulateHeatmap(plan, records),
    status: "ready",
    retry: () => undefined,
    monthStartMs: plan.monthStartMs,
    canGoNext: false,
    goPrevious: () => undefined,
    goNext: () => undefined,
    ...overrides,
  };
}

/** 有一点数据的模型：空模型走空态，格子根本不渲染（那是 hm03 的判据） */
function seeded(): HeatmapState {
  const plan = buildHeatmapPlan(NOW);
  const today = plan.days[11]; // 11-12
  return makeState([{ startTime: today.startMs + 9 * HOUR, endTime: today.startMs + 10 * HOUR }]);
}

function cells(): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(".at-heatmap__cell") ?? []);
}

describe("活动热力图卡", () => {
  it("hm01_a_day_row_on_top_then_six_bucket_rows_over_the_whole_month", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const labels = Array.from(container?.querySelectorAll<HTMLElement>(".at-heatmap__bucket-label") ?? [])
      .map((node) => node.textContent ?? "");
    /* 「day」在最上面，下面只写时段起点（不再写 0–4 / 4–8 这种区间） */
    expect(labels).toEqual(["day", "0", "4", "8", "12", "16", "20"]);
    /* 11 月整月 30 列 × (6 段 + 合计) = 210 格；今天之后的日期也照样有列 */
    expect(container?.querySelectorAll(".at-heatmap__date")).toHaveLength(30);
    expect(cells()).toHaveLength(30 * 7);
    expect(container?.querySelectorAll(".at-heatmap__cell--total")).toHaveLength(30);
    /* 日期每 5 天标一次：1、5、10、15… 其余留空 */
    const visibleDates = Array.from(container?.querySelectorAll<HTMLElement>(".at-heatmap__date") ?? [])
      .map((node) => node.textContent ?? "")
      .filter(Boolean);
    expect(visibleDates).toEqual(["1", "5", "10", "15", "20", "25", "30"]);
  });

  it("hm01b_days_after_today_are_still_columns_and_marked_future", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const futureTotal = container?.querySelector<HTMLElement>('[data-date="2026-11-30"].at-heatmap__cell--total');
    expect(futureTotal?.dataset.future).toBe("true");
    expect(futureTotal?.dataset.level).toBeUndefined();
    /* 未来的天：合计 + 6 段全是虚线，不是零活动 */
    expect(container?.querySelectorAll('[data-date="2026-11-30"][data-future="true"]')).toHaveLength(7);
  });

  it("hm02_the_seeded_bucket_is_the_peak_and_quiet_cells_stay_level_zero", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    /* 今天 9 点 → 8–12 段（bucket 2），峰值 → level 5；同一天 4–8 段是零 */
    const peak = container?.querySelector<HTMLElement>('[data-date="2026-11-12"][data-bucket="2"]');
    const quiet = container?.querySelector<HTMLElement>('[data-date="2026-11-12"][data-bucket="1"]');
    expect(peak?.dataset.level).toBe("5");
    expect(quiet?.dataset.level).toBe("0");
  });

  it("hm03_buckets_that_have_not_started_are_future_not_zero", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    /* 14:30 → 16–20 与 20–24 还没到：虚线，不是"零活动" */
    for (const bucket of ["4", "5"]) {
      const cell = container?.querySelector<HTMLElement>(`[data-date="2026-11-12"][data-bucket="${bucket}"]`);
      expect(cell?.dataset.future, `bucket ${bucket} 被画成了零活动`).toBe("true");
      expect(cell?.dataset.level).toBeUndefined();
    }
    /* 过去的日期没有"未来段" */
    expect(container?.querySelector('[data-date="2026-11-05"][data-future="true"]')).toBeNull();
  });

  it("hm04_no_activity_shows_the_empty_state_and_no_grid", async () => {
    await mount(createElement(HeatmapModule, {
      state: { ...makeState(), model: emptyHeatmapModel() },
    }));
    expect(container?.querySelector(".at-heatmap__grid")).toBeNull();
    expect(container?.textContent).toBeTruthy();
  });

  it("hm05_the_grid_is_a_single_labelled_image_with_a_legend_of_five_steps", async () => {
    await mount(createElement(HeatmapModule, { state: seeded() }));
    const grid = container?.querySelector<HTMLElement>(".at-heatmap__grid");
    expect(grid?.getAttribute("role")).toBe("img");
    expect(grid?.getAttribute("aria-label") ?? "").toContain("热力图");
    expect(container?.querySelectorAll(".at-heatmap__legend i")).toHaveLength(5);
    /* 卡头读数是本月合计（旧的「近 4 周」口径随轴一起下线） */
    expect(container?.querySelector(".at-card-meta")?.textContent ?? "").toContain("合计");
  });

  it("hm06_the_month_navigation_can_go_back_but_not_into_the_future", async () => {
    const goPrevious = vi.fn();
    const goNext = vi.fn();
    await mount(createElement(HeatmapModule, {
      state: makeState([], { goPrevious, goNext, canGoNext: false }),
    }));
    const previous = container?.querySelector<HTMLButtonElement>('button[aria-label="上一个月"]');
    const next = container?.querySelector<HTMLButtonElement>('button[aria-label="下一个月"]');
    expect(previous?.disabled).toBe(false);
    act(() => { previous?.click(); });
    expect(goPrevious).toHaveBeenCalledTimes(1);
    /* 已经是当前月：不许再往后翻（未来的月份没有数据） */
    expect(next?.disabled).toBe(true);
    expect(container?.querySelector(".at-heatmap-range")?.textContent ?? "").toContain("2026");
  });

  it("hm07_a_past_month_shows_that_month_and_allows_going_forward", async () => {
    const plan = buildHeatmapPlan(NOW, 1);
    await mount(createElement(HeatmapModule, {
      state: {
        ...makeState(),
        model: accumulateHeatmap(plan, [
          { startTime: plan.days[0].startMs + 9 * HOUR, endTime: plan.days[0].startMs + 10 * HOUR },
        ]),
        monthStartMs: plan.monthStartMs,
        canGoNext: true,
      },
    }));
    expect(container?.querySelector(".at-heatmap-range")?.textContent ?? "").toContain("2026");
    expect(container?.querySelectorAll(".at-heatmap__date")).toHaveLength(31);
    expect(container?.querySelector<HTMLButtonElement>('button[aria-label="下一个月"]')?.disabled).toBe(false);
    /* 整月都是过去的：一格 future 都不该有 */
    expect(container?.querySelector('[data-future="true"]')).toBeNull();
  });
});