(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TrendModule from "./TrendModule.tsx";
import type { TrendDay } from "../services/trendDays.ts";
import type { TrendState } from "../hooks/useTrendDays.ts";

/**
 * 今日活动趋势卡的**行为**判据（纯函数判据在 `services/trendDays.test.ts`）。
 *
 * 为什么这些必须测：全部是"错了也照样渲染"的静默项 ——
 *   · 按 1 小时归一 → 每根柱都矮，看不出起伏，但没有任何报错；
 *   · 当前这一小时不高亮 → 用户分不清最后一根是"现在"还是"今天某个历史小时"；
 *   · 24 根柱每根都挂轴文字 → 窄卡里糊成一片，没有报错；
 *   · 全 0 不判空态 → 一墙 2px 桩子 + 一句"没有记录"的空白卡。
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

/**
 * 挂载前先把语言包预热好再包 `LocaleProvider`：Provider 在文案未就绪时返回 `null`，
 * 直接渲染会得到一片空白（不是失败，是"什么都没画"，最难查）。
 */
async function mount(element: Parameters<Root["render"]>[0]) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })));
}

const HOUR = 3600_000;

/** 今日逐时桶：从本地 00:00 起，每格一小时，最后一个窗口右端裁到 18:24（与真实 hook 同形） */
function hourModel(durations: number[]): TrendState {
  const dayStart = new Date(2026, 10, 11, 0, 0, 0).getTime();
  const days: TrendDay[] = durations.map((durationMs, index) => {
    const startMs = dayStart + index * HOUR;
    const isLast = index === durations.length - 1;
    return {
      key: `h${index}`,
      startMs,
      endMs: isLast ? startMs + 24 * 60_000 : startMs + HOUR,
      durationMs,
    };
  });
  return { days, status: "ready", retry: () => undefined };
}

function bars() {
  return Array.from(container?.querySelectorAll<HTMLElement>(".qp-trend__bar") ?? []);
}

describe("今日活动趋势卡", async () => {
  it("tr01_tallest_hour_fills_the_track_and_the_current_hour_is_marked", async () => {
    await mount(createElement(TrendModule, { model: hourModel([HOUR, 2 * HOUR, 30 * 60_000]) }));
    const list = bars();
    expect(list).toHaveLength(3);
    /* 峰值归一：最长那格 100%，第一格 50%。按 1 小时归一会得到 100% / 100% / 50%（看不出走势）。
       外面再包一层 `max(…, 3px)`：卡被拖到很矮时百分比会小于 3px，
       柱子会缩成看不见的一条 —— Rust `trend.rs:82` 也是 `h.max(3.0)`。 */
    expect(list[1].style.height).toBe("max(100%, 3px)");
    expect(list[0].style.height).toBe("max(50%, 3px)");
    const nowLanes = container?.querySelectorAll(".qp-trend__day.is-today") ?? [];
    expect(nowLanes).toHaveLength(1);
    /* 当前这一小时必须是**最后一根**：标错位置比不标更糟 */
    expect(Array.from(container?.querySelectorAll(".qp-trend__day") ?? []).at(-1)?.className).toContain("is-today");
  });

  it("tr02_zero_hour_gets_a_stub_but_a_tiny_hour_stays_visible", async () => {
    await mount(createElement(TrendModule, { model: hourModel([0, 12_000, HOUR]) }));
    const list = bars();
    /* 0 = 这个小时真的没用过：不给柱高百分比，只留 2px 底桩（Rust `1.5` 高的 track 色桩），
       并用 `data-empty` 换成轨道色 —— 与"有量但极小"那根区分开 */
    expect(list[0].style.height).toBe("2px");
    expect(list[0].closest(".qp-trend__day")?.hasAttribute("data-empty")).toBe(true);
    /* 12 秒那种极小值必须留一条可见的边：0 高等于在说"没用过"，是假话 */
    expect(list[1].style.height).toBe("max(4%, 3px)");
    expect(list[1].closest(".qp-trend__day")?.hasAttribute("data-empty")).toBe(false);
  });

  it("tr03_all_zero_renders_the_empty_state_not_a_wall_of_stubs", async () => {
    await mount(createElement(TrendModule, { model: hourModel([0, 0, 0]) }));
    expect(container?.querySelector(".qp-trend")).toBeNull();
    expect(container?.textContent).toBeTruthy();
  });

  it("tr04_readouts_are_today_total_and_the_peak_hour", async () => {
    /* 0 点 30 分钟 + 14 点 1h20m（峰值），其余小时为 0 → 今日合计 1h 50m */
    const durations = [30 * 60_000, ...Array.from({ length: 13 }, () => 0), 80 * 60_000];
    await mount(createElement(TrendModule, { model: hourModel(durations) }));
    const head = container?.querySelector(".qp-trend-head");
    const text = head?.textContent ?? "";
    expect(text).toContain("今日 1h 50m");
    /* 峰值读数必须带**时刻**（14:00），不是只有时长 —— "峰值 1h 20m"说不出是哪一小时 */
    expect(text).toContain("峰值 14:00 · 1h 20m");
    /* 「日均」这个读数随 14 天口径一起下线，一天之内没有日均可言 */
    expect(text).not.toContain("日均");
  });

  it("tr05_only_three_axis_labels_and_the_last_one_says_now", async () => {
    /* 24 根柱：0…23，最后一格是当前小时 */
    const durations = Array.from({ length: 24 }, () => HOUR);
    await mount(createElement(TrendModule, { model: hourModel(durations) }));
    const labels = Array.from(container?.querySelectorAll<HTMLElement>(".qp-trend__label") ?? [])
      .map((node) => node.textContent ?? "");
    /* 每根柱都有一个 span，但只有三处写字（首 / 中 / 末） */
    expect(labels).toHaveLength(24);
    expect(labels.filter((text) => text.length > 0)).toHaveLength(3);
    expect(labels[0]).toBe("0点");
    expect(labels[labels.length - 1]).toBe("现在");
    /* 中间那处是小时（zh 用「N点」） */
    expect(labels[12]).toBe("12点");
    /* 窗口数进 DOM 与 CSS 变量：24 根柱靠 `--qp-trend-n` 平分容器宽度（不横向滚动） */
    expect(container?.querySelector(".qp-trend")?.getAttribute("data-trend-days")).toBe("24");
    expect((container?.querySelector<HTMLElement>(".qp-trend")?.style.getPropertyValue("--qp-trend-n"))).toBe("24");
  });

  it("tr06_bar_tooltip_says_the_hour_range_and_the_duration", async () => {
    await mount(createElement(TrendModule, { model: hourModel([0, 0, 0, 0, 0, 0, 0, 0, 0, 32 * 60_000, 0]) }));
    const title = bars()[9].getAttribute("title") ?? "";
    /* 「09:00–10:00 · 32m」：只有高度的柱对读屏是空白，范围必须说出来 */
    expect(title).toContain("09:00–10:00");
    expect(title).toContain("32m");
  });
});
