(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimerModule from "./TimerModule.tsx";
import type { CategoryDistItem } from "../services/dashboardFormatting.ts";
import type { FocusDimension } from "../services/focusDimension.ts";

/**
 * 计时分布卡：**环心 / 卡头 / 空态三者必须同一份数**（2026-11-14 修的那条）。
 *
 * 上一版环心与卡头印的是 `totalTrackedTime`（**应用活动**总量），而环与空态看的是
 * 当前维度（分类 / 应用 / 事项）的分段。切到「事项」维度、今天还没有任何计时记录时，
 * 卡里同时出现「今天还没有计时」和「40m 今日合计」，环里一个弧都没有 —— 三个数字
 * 来自两个源，用户只能读成"这张卡坏了"。
 *
 * 变异自证（把 `total` 换回任意外部总量 / 把空态文案写死成同一句）会让 tm01 红。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

const MIN = 60000;

const slice = (name: string, minutes: number, category: CategoryDistItem["category"] = "other"): CategoryDistItem => ({
  category,
  name,
  value: minutes * MIN,
  color: "#4a9eff",
});

async function mount(options: {
  categoryDist: CategoryDistItem[];
  dimension: FocusDimension;
  dayDeltaTrackedTime?: number;
  onDimensionChange?: (dimension: FocusDimension) => void;
}) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimerModule, {
        categoryDist: options.categoryDist,
        dimension: options.dimension,
        onDimensionChange: options.onDimensionChange ?? (() => undefined),
        dayDeltaTrackedTime: options.dayDeltaTrackedTime ?? 0,
        status: "ready",
        refreshError: false,
        onRetry: () => undefined,
      }),
    }));
  });
}

const card = () => container?.querySelector<HTMLElement>(".qp-card") ?? null;
const donutTotal = () => container?.querySelector(".qp-donut-total")?.textContent ?? null;
const donutCap = () => container?.querySelector(".qp-donut-cap")?.textContent ?? null;
const emptyText = () => container?.querySelector(".qp-empty")?.textContent ?? null;

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

describe("计时分布卡 · 读数口径", () => {
  it("tm01_item_dimension_with_no_records_reads_zero_not_activity_total", async () => {
    /* 事项维度空 + 应用活动「较昨日 +40m」：环心只能是 0m。
       上一版这里印的是应用活动总量（40m），于是卡里同时说"今天还没有计时"。 */
    await mount({ categoryDist: [], dimension: "item", dayDeltaTrackedTime: 40 * MIN });

    expect(card()?.getAttribute("data-state")).toBe("empty");
    expect(donutTotal(), "环心读数吃了应用活动总量").toBe("0m");
    expect(donutCap()).toBe("今日事项合计");
    expect(emptyText()).toBe("今天还没有计时事项");
    /* 事项维度不显示「较昨日」：那是应用活动的差值，挂在事项维度上就是假话 */
    expect(container?.querySelector(".qp-focus-delta")).toBeNull();
  });

  it("tm02_item_dimension_shows_its_own_total", async () => {
    await mount({ categoryDist: [slice("Timing优化", 40), slice("摸鱼", 20)], dimension: "item" });

    expect(card()?.getAttribute("data-state")).toBe("ready");
    expect(donutTotal()).toBe("1h 0m");
    expect(container?.querySelector(".qp-card-meta")?.textContent).toContain("今日 1h 0m");
    /* 底圈 + 两段 = 三根 circle（段数 = 读数行数这条不变）。
       只数 svg 的**直接子节点**：`AnonymousActivityPattern` 在 `<defs>` 里也有 circle。 */
    expect(container?.querySelectorAll(".qp-donut svg > circle")).toHaveLength(3);
  });

  it("tm03_category_dimension_keeps_yesterday_delta", async () => {
    await mount({ categoryDist: [slice("开发", 40, "development")], dimension: "category", dayDeltaTrackedTime: 10 * MIN });
    expect(container?.querySelector(".qp-focus-delta")).not.toBeNull();
    expect(donutCap()).toBe("今日合计");
  });

  it("tm05_dimension_tabs_stay_clickable_in_the_empty_state", async () => {
    /* 死路判据：维度条原在 children 里 → 空态下整条消失，用户切不回别的维度，
       卡永远停在空环上。现在它挂在 `subhead`（四态常驻），三个 tab 必须都在且能点。 */
    const onDimensionChange = vi.fn<(dimension: FocusDimension) => void>();
    await mount({ categoryDist: [], dimension: "item", onDimensionChange });

    const tabs = Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-focus-dim") ?? []);
    expect(tabs.map((tab) => tab.textContent)).toHaveLength(3);
    act(() => { tabs[0]?.click(); });
    expect(onDimensionChange).toHaveBeenCalledWith("category");
  });

  it("tm04_empty_ring_is_wrapped_so_the_caption_cannot_cover_it", async () => {
    /* 布局前提：环与空文案在**同一块**里纵排（`.qp-empty-figure`）。
       写成两个并列子项时，`.qp-empty` 的 `flex: 1 1 auto` 会吃满整卡剩余高度，
       环只能溢出卡外被裁 —— 观感是"文字压在环上、环只剩上半截"。 */
    await mount({ categoryDist: [], dimension: "category" });
    const donut = container?.querySelector(".qp-donut");
    const figure = container?.querySelector(".qp-empty-figure");
    expect(figure).not.toBeNull();
    expect(donut?.parentElement).toBe(figure);
    expect(figure?.querySelector(".qp-empty")).not.toBeNull();
  });
});
