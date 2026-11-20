(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimerModule from "./TimerModule.tsx";
import type { CategoryDistItem } from "../services/dashboardFormatting.ts";
import type { FocusDimension } from "../services/focusDimension.ts";

/**
 * V-1.2b：计时分布**空数据仍画底圈**。
 *
 * 为什么要钉：只给一句 `at-empty` 的空态，"卡是空的还是坏了"分不出来 ——
 * 一圈底环 + 环心读数（今日 0m）说的是"今天真的什么都没记"。回归的坏法是静默的：
 * 有人把 donut 的渲染条件写成 `total > 0`，空卡立刻退化成一行字，没有任何报错。
 *
 * [0.12.6 · M2] 空态还有**第二种成因**，这条更隐蔽：一整天只有工具类应用。
 * 工具类被统计口径排除（`dashboardReadModel.splitToolStats`），于是环里一段都没有 ——
 * 但右下角的排行里明明有三行时长。照旧写「今天还没有记录」就是一句看得见的假话，
 * 所以空态要说出"只有工具类、不计入统计"以及被排除的时长。
 * 判据读的是 `excludedToolTime`（读模型早就有这个数，M2 之前一个消费者都没有）。
 */
let container: HTMLDivElement | null = null;
let root: Root | null = null;

const MIN = 60_000;
const HOUR = 3_600_000;

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

interface MountOptions {
  categoryDist?: CategoryDistItem[];
  dimension?: FocusDimension;
  /** 被「工具」标签排除掉的时长；不传 = 0（与 M2 之前的行为一致） */
  excludedToolTime?: number;
}

async function mount(options: MountOptions = {}) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimerModule, {
        categoryDist: options.categoryDist ?? [],
        dimension: options.dimension ?? "category",
        onDimensionChange: () => undefined,
        dayDeltaTrackedTime: 0,
        excludedToolTime: options.excludedToolTime ?? 0,
        status: "ready",
        refreshError: false,
        onRetry: () => undefined,
      }),
    }));
  });
}

const card = () => container?.querySelector<HTMLElement>(".at-card") ?? null;
const emptyText = () => container?.querySelector(".at-empty")?.textContent ?? null;

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
    const card = container?.querySelector<HTMLElement>(".at-card");
    expect(card?.getAttribute("data-state")).toBe("empty");
    /* 空态文案在，但**不只**是文案：底环还在 */
    expect(container?.querySelector(".at-empty")).not.toBeNull();
    const donut = container?.querySelector(".at-donut");
    expect(donut).not.toBeNull();
    /* 底圈 = 一根轨道色 circle（`stroke=var(--at-track-muted)`），环心读数是"今日 0m" */
    expect(donut?.querySelector("svg circle")).not.toBeNull();
    expect(donut?.querySelector(".at-donut-total")?.textContent).toBe("0m");
    /* 渲染零报错：空态分支走的是同一份 donut JSX，不该有 React 警告 */
    expect(errors).toHaveLength(0);
  });

  it("te02_all_tools_input_explains_why_the_ring_is_empty", async () => {
    /* QA 那一组：IDM 2h + Terminal 1h 都带「工具」标签 → 环里 0 段、excludedToolTime 3h */
    await mount({ excludedToolTime: 3 * HOUR });

    expect(card()?.getAttribute("data-state")).toBe("empty");
    expect(emptyText(), "空态说了句假话：排行里明明有三行时长").toBe("今天只有工具类应用（3h 0m），不计入统计");
    /* 底环与环心读数照旧（"卡是空的"而不是"卡坏了"），只是换了一句解释 */
    expect(container?.querySelector(".at-donut-total")?.textContent).toBe("0m");
    /* 空态没有卡头读数（`ModuleShell` 只在 ready 印 meta），这句文案就是唯一的解释 */
    expect(container?.querySelector(".at-card-meta")).toBeNull();
  });

  it("te03_no_excluded_tool_time_keeps_the_plain_empty_text", async () => {
    /* 真正的"今天什么都没发生"：不能挂上一句"只有工具类应用" */
    await mount({ excludedToolTime: 0 });
    expect(emptyText()).toBe("今天还没有计时");
  });

  it("te04_item_dimension_does_not_borrow_the_tool_explanation", async () => {
    /* 事项维度吃的是计时记录，与"应用有没有被标成工具"毫无关系：
       在这里写「只有工具类应用」是拿另一把尺子解释这一把 */
    await mount({ dimension: "item", excludedToolTime: 3 * HOUR });
    expect(emptyText()).toBe("今天还没有计时事项");
  });

  it("te05_a_single_tool_minute_still_gets_the_explanation", async () => {
    /* 判据是 `> 0` 而不是"有没有一小时"：刚过一分钟也是"只有工具类" */
    await mount({ excludedToolTime: MIN });
    expect(emptyText()).toBe("今天只有工具类应用（1m），不计入统计");
  });
});
