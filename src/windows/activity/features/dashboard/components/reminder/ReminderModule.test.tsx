(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../../shared/i18n/runtime.ts";

/**
 * 活动提醒卡的**紧凑表单**判据（2026-11-20 主人口径：占用高度更小）。
 *
 * 两行，不许退回四行：
 *   ① 第一行 =「目标」标签 + 应用候选选择器；
 *   ② 第二行 =「每日上限」标签 + 时长选择 + 「创建」。
 * 规则编辑弹层不挂 `.at-reminder-form`，仍用竖排字段，所以这里只钉卡内表单。
 */
vi.mock("../../hooks/useActivityReminders.ts", () => ({
  useActivityReminders: () => ({
    appCandidates: [],
    categoryCandidates: [],
    webCandidates: [],
    candidateLoadState: { app: "ready", category: "ready", web: "ready" },
    ruleRows: [],
    busyAction: null,
    loadError: null,
    actionError: null,
    retryLoad: () => undefined,
    retryCandidates: () => undefined,
    createRule: async () => null,
    setRuleEnabled: async () => undefined,
    disableRule: async () => undefined,
    updateLimit: async () => false,
  }),
}));

import ReminderModule from "./ReminderModule.tsx";

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

describe("活动提醒卡 · 紧凑表单", () => {
  it("rm01_creation_form_is_two_rows_target_then_duration_and_create", async () => {
    await resolveLocaleActivation("zh-CN", () => true);
    act(() => root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(ReminderModule, { icons: {} }),
    })));

    const rows = Array.from(container?.querySelectorAll<HTMLElement>(".at-reminder-form-row") ?? []);
    expect(rows).toHaveLength(2);

    const [targetRow, actionRow] = rows;
    expect(targetRow.querySelector(".tools-activity-target-search")).not.toBeNull();
    expect(targetRow.querySelector(".at-time-picker-trigger")).toBeNull();
    expect(actionRow.querySelector(".at-time-picker-trigger")).not.toBeNull();
    expect(actionRow.querySelector(".tools-form-actions")).not.toBeNull();
  });
});
