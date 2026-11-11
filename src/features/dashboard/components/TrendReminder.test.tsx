(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TrendModule from "./TrendModule.tsx";
import ReminderModule from "./ReminderModule.tsx";
import type { TrendDay } from "../services/trendDays.ts";
import type { TrendState } from "../hooks/useTrendDays.ts";
import type { PendingRemindersState } from "../hooks/usePendingReminders.ts";
import type { PendingReminder } from "../../../platform/persistence/reminderReadRepository.ts";

/**
 * [两张真卡 · 0.12.1] 行为判据：柱高归一、今天高亮、空态、提醒的到点标记。
 *
 * 为什么这些必须测：全部是"错了也照样渲染"的静默项 ——
 *   · 按 24 小时归一 → 每根柱都矮，看不出起伏，但没有任何报错；
 *   · 今天不高亮 → 用户分不清最后一根是今天还是昨天；
 *   · 全 0 不判空态 → 七根 0 高柱子 + 一句"没有记录"的空白卡。
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

const DAY = 24 * 3600_000;

function trendModel(durations: number[]): TrendState {
  const base = new Date(2026, 10, 11, 0, 0, 0).getTime();
  const days: TrendDay[] = durations.map((durationMs, index) => {
    const startMs = base - (durations.length - 1 - index) * DAY;
    return { key: `d${index}`, startMs, endMs: startMs + DAY, durationMs };
  });
  return { days, status: "ready", retry: () => undefined };
}

describe("应用趋势卡", async () => {
  it("tr01_tallest_day_fills_the_track_and_today_is_marked", async () => {
    await mount(createElement(TrendModule, { model: trendModel([3600_000, 7200_000, 1800_000]) }));
    const bars = Array.from(container?.querySelectorAll<HTMLElement>(".qp-trend__bar") ?? []);
    expect(bars).toHaveLength(3);
    /* 峰值归一：最长那根 100%，第二根 50%。按 24h 归一会得到 8% / 4%（看不出走势） */
    expect(bars[1].style.height).toBe("100%");
    expect(bars[0].style.height).toBe("50%");
    const today = container?.querySelectorAll(".qp-trend__day.is-today") ?? [];
    expect(today).toHaveLength(1);
    /* 今天必须是**最后一根**：标错位置比不标更糟 */
    expect(Array.from(container?.querySelectorAll(".qp-trend__day") ?? []).at(-1)?.className).toContain("is-today");
  });

  it("tr02_zero_day_gets_no_bar_but_a_tiny_day_stays_visible", async () => {
    await mount(createElement(TrendModule, { model: trendModel([0, 12_000, 3600_000]) }));
    const bars = Array.from(container?.querySelectorAll<HTMLElement>(".qp-trend__bar") ?? []);
    /* 0 = 这天真的没用过，柱高 0 */
    expect(bars[0].style.height).toBe("0%");
    /* 12 秒那种极小值必须留一条可见的边：0 高等于在说"没用过"，是假话 */
    expect(bars[1].style.height).not.toBe("0%");
  });

  it("tr03_all_zero_renders_the_empty_state_not_seven_empty_bars", async () => {
    await mount(createElement(TrendModule, { model: trendModel([0, 0, 0]) }));
    expect(container?.querySelector(".qp-trend")).toBeNull();
    expect(container?.textContent).toBeTruthy();
  });
});

describe("提醒窗口卡", async () => {
  const reminder = (id: number, remindAt: number, target: PendingReminder["target"] = "todo"): PendingReminder => ({
    target,
    targetId: id,
    title: `事项 ${id}`,
    remindAt,
  });

  const model = (list: PendingReminder[]): PendingRemindersState => ({
    reminders: list,
    status: "ready",
    retry: () => undefined,
  });

  it("rm01_due_reminders_are_marked_and_past_ones_come_from_the_hook_order", async () => {
    const now = Date.now();
    await mount(createElement(ReminderModule, {
      model: model([reminder(1, now - 60_000), reminder(2, now + 3600_000)]),
    }));
    const rows = Array.from(container?.querySelectorAll(".qp-reminder__row") ?? []);
    expect(rows).toHaveLength(2);
    /* 已经过点的那条要标出来：它是"该响还没处理"，与未来那条语气不同 */
    expect(rows[0].className).toContain("is-due");
    expect(rows[1].className).not.toContain("is-due");
  });

  it("rm02_empty_list_renders_the_empty_state", async () => {
    await mount(createElement(ReminderModule, { model: model([]) }));
    expect(container?.querySelector(".qp-reminder")).toBeNull();
  });
});
