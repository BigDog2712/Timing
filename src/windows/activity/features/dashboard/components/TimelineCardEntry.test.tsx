(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 卡底三颗入口在 **empty / error 态**也必须真的能开弹层（[回归] 0.13 · 1.6 漏了这一步）。
 *
 * ## 这条用例为什么必须存在
 *
 * 三颗按钮挂在 `ModuleShell` 的 `footer`（四态常驻），而三个弹层组件当初写在
 * `ModuleShell` 的 **children** 里 —— children **只在 ready 态渲染**。于是：
 *
 *   今天还没有计时（empty 态）→ 点「新建事项」→ `setDialog("create")` 确实执行了，
 *   但消费这个状态的 `TimelineManage` 根本没挂载 ⇒ **一点反应都没有**，零报错、零提示。
 *
 * 这正是"今天没有计时"这一天最需要入口的时刻，四颗键全哑而测试全绿 ——
 * 因为已有用例（`TimelineCardR2.test.tsx` tc02/tc05）都传了行数据，跑在 ready 态。
 *
 * 判据只有一条：**空态下点一次，弹层真的在 DOM 里**。`QuietDialog` portal 到 body，
 * 所以查的是 `document.body`，不是卡片容器。
 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async () => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingRecords: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
  listTimingRecords: h.listTimingRecords,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimelineCard from "./TimelineCard.tsx";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(status: LoadStatus) {
  const element: ReactElement = createElement(TimelineCard, {
    items: [],
    total: 0,
    tier: "M",
    status,
    refreshError: false,
    onRetry: () => undefined,
    onLocalRename: () => undefined,
    onLocalCreate: () => undefined,
  });
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => { root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element })); });
  await flush();
}

/** 卡底那颗入口（按文案找，不按下标 —— 顺序变了要能自己报出来） */
function entry(label: string): HTMLButtonElement | null {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>(".qp-timeline-manage button") ?? [])
    .find((button) => button.textContent === label) ?? null;
}

function openDialogTitle(): string | null {
  const surface = document.body.querySelector(".qp-dialog-surface");
  return surface?.querySelector(".qp-dialog-title")?.textContent ?? null;
}

beforeEach(() => {
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({});
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  /* 弹层 portal 到 body：卸载不会带走它们（`QuietDialog` 卸载时才关），逐个摘掉 */
  document.body.querySelectorAll(".qp-dialog-backdrop").forEach((node) => node.remove());
});

describe("时间线卡 · 卡底入口在非 ready 态也要能开弹层", () => {
  it("tl09_empty_state_new_item_opens_the_create_dialog", async () => {
    await mount("ready");
    /* 前提：没有行 ⇒ 卡进空态（"今天还没有计时"），但三颗入口在场 */
    expect(container?.querySelector(".qp-card")?.getAttribute("data-state")).toBe("empty");
    expect(entry("新建事项")).not.toBeNull();

    act(() => { entry("新建事项")?.click(); });
    await flush();

    expect(openDialogTitle(), "空态下点「新建事项」没有弹出任何东西").toBe("新建事项");
  });

  it("tl10_empty_state_edit_and_manage_open_their_dialogs_too", async () => {
    await mount("ready");
    act(() => { entry("编辑事项")?.click(); });
    await flush();
    expect(openDialogTitle(), "空态下点「编辑事项」没有弹出任何东西").toBe("编辑事项");

    act(() => { entry("事项管理")?.click(); });
    await flush();
    expect(openDialogTitle(), "空态下点「事项管理」没有弹出任何东西").toBe("事项管理");
  });

  it("tl11_error_state_entries_are_alive_as_well", async () => {
    /* 读失败（E2）时卡里只有错误块，三颗入口同样在场 —— 一样的坑，一起钉住 */
    await mount("error");
    expect(container?.querySelector(".qp-card")?.getAttribute("data-state")).toBe("error");
    act(() => { entry("新建事项")?.click(); });
    await flush();
    expect(openDialogTitle(), "错误态下点「新建事项」没有弹出任何东西").toBe("新建事项");
  });
});
