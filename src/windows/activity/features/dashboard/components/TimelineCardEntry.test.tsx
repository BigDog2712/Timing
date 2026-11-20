(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 入口在 **empty / error 态**也必须真的能开弹层（[回归] 0.13 · 1.6 漏过这一步）。
 *
 * ## 这条判据为什么必须存在
 *
 * 入口挂在"四态之外"的位置（区标题行 / 区标题行下的窄行），而消费弹层状态的组件一旦
 * 写进**四态分支里**，症状就是：
 *
 *   · 今天还没有任何事项（empty）→ 点「新增」→ `setDialog("create")` 确实执行了，
 *     但 `TimelineManage` 根本没挂载 ⇒ **一点反应都没有**，零报错、零提示。
 *
 * 这正是"库里还什么都没有"那一天最需要入口的时刻。已有用例大多传了行数据、跑在 ready 态，
 * 所以四态之外的位置必须单独钉住。
 *
 * ## [0.12.6] 入口搬了家，判据跟着走
 *
 * 0.12.5 的时间线卡卡底有三颗入口（新建 / 编辑 / 事项管理）。0.12.6 起它们**整组搬进了
 * 「事项管理」独立卡**的区标题行（`ManageCard` → `ItemsManageZone`），时间线卡只保留
 * 上区那条「新建待办」。所以本册分两段：
 *   · 用 `ManageCard` 钉"空态 / 错误态点「新增」仍能打开事项弹层"；
 *   · 用 `TimelineTodosCard` 钉"上区「新建待办」在四态之外常驻，空态点它能开新建待办弹层"。
 *
 * 判据只有一条：**点一次，弹层真的在 DOM 里**。`QuietDialog` portal 到 body，所以查的是
 * `document.body`，不是卡片容器。
 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent?: unknown): Promise<boolean> => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingRecords: vi.fn(async (): Promise<unknown[]> => []),
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
  getItemTimeline: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  loadAppItemBindingUnions: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  mirrorItemBindingsOnce: vi.fn(async (): Promise<void> => undefined),
  listAppItemBindingOptions: vi.fn(async (): Promise<unknown[]> => []),
  saveAppItemBinding: vi.fn(async (): Promise<void> => undefined),
  aiConfigGet: vi.fn(async (): Promise<unknown> => ({
    config: { enabled: true, itemTagsEnabled: true, appTagsEnabled: true },
    hasKey: true,
    secretAvailable: true,
  })),
  listTagDefinitions: vi.fn(async (): Promise<string[]> => ["工作"]),
  createTagDefinition: vi.fn(async (): Promise<string[]> => []),
  aiSuggestTags: vi.fn(async (): Promise<unknown> => ({
    suggestions: [],
    stats: { parsed: 0, dropped: 0, attempts: 1 },
  })),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
  listTimingRecords: h.listTimingRecords,
  listTimingItemTags: h.listTimingItemTags,
}));
vi.mock("../../../platform/persistence/attributionGateway.ts", () => ({
  getItemTimeline: h.getItemTimeline,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));
vi.mock("../../../platform/desktop/hostAiGateway.ts", () => ({
  aiConfigGet: h.aiConfigGet,
  aiSuggestTags: h.aiSuggestTags,
}));
vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  listTagDefinitions: h.listTagDefinitions,
  createTagDefinition: h.createTagDefinition,
}));
vi.mock("../services/appItemBinding.ts", () => ({
  listAppItemBindingOptions: h.listAppItemBindingOptions,
  saveAppItemBinding: h.saveAppItemBinding,
  resolveAppItemBindingExe: (name: string): string => name.trim().toLowerCase(),
}));
vi.mock("../services/appItemBindingMirror.ts", () => ({
  loadAppItemBindingUnions: h.loadAppItemBindingUnions,
  mirrorItemBindingsOnce: h.mirrorItemBindingsOnce,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import type { LoadStatus } from "../../../shared/types/loadStatus.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { TodayTodosState } from "../hooks/useTodayTodos.ts";
import ManageCard, { NO_MANAGE_ACTIONS } from "./ManageCard.tsx";
import TimelineTodosCard from "./TimelineTodosCard.tsx";

const COPY = DASHBOARD_COPY["zh-CN"];

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function render(element: ReturnType<typeof createElement>) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, { locale: "zh-CN", children: element }));
  });
  await flush();
}

/** 事项管理卡：区标题行里那四颗动作的宿主 */
async function mountManage() {
  await render(createElement(ManageCard, {
    title: COPY.cardLabels.manage,
    todayItems: { rows: [], applyLocalRename: () => undefined, applyLocalCreate: () => undefined },
    actions: NO_MANAGE_ACTIONS,
  }));
}

const NO_TODOS: TodayTodosState = {
  todos: [],
  status: "ready",
  pending: null,
  create: async () => false,
  toggle: () => undefined,
  remove: () => undefined,
  createBatch: async () => false,
  update: async () => false,
  undoPending: () => undefined,
  retry: () => undefined,
};

/** 今日时间线卡：上区待办是 `新建待办` 的宿主 */
async function mountTimelineCard(todosStatus: LoadStatus) {
  await render(createElement(TimelineTodosCard, {
    title: COPY.cardLabels.timeline,
    todayItems: { rows: [], total: 0, status: "ready", retry: () => undefined },
    todosModel: { ...NO_TODOS, status: todosStatus },
    refreshError: false,
  }));
}

const zoneButton = (label: string) =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-items-zone-actions button") ?? [])
    .find((button) => (button.textContent ?? "").trim() === label) ?? null;
const todosEntry = () =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-todo-new-row button") ?? [])
    .find((button) => (button.textContent ?? "").trim() === COPY.todoNewTodo) ?? null;
const openDialogTitle = () =>
  document.body.querySelector(".at-dialog-surface .at-dialog-title")?.textContent ?? null;

beforeEach(() => {
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([]);
  h.listTimingRecords.mockReset();
  h.listTimingRecords.mockResolvedValue([]);
  h.listTimingItemTags.mockReset();
  h.listTimingItemTags.mockResolvedValue([]);
  h.getItemTimeline.mockReset();
  h.getItemTimeline.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({});
  h.loadAppItemBindingUnions.mockReset();
  h.loadAppItemBindingUnions.mockResolvedValue({});
  h.mirrorItemBindingsOnce.mockReset();
  h.listAppItemBindingOptions.mockReset();
  h.listAppItemBindingOptions.mockResolvedValue([]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  /* 弹层 portal 到 body：卸载不会带走它们，逐个摘掉 */
  document.body.querySelectorAll(".at-dialog-backdrop").forEach((node) => node.remove());
});

describe("事项管理卡 · 空态 / 错误态下三颗入口也要能开弹层", () => {
  it("tl09_empty_state_new_item_opens_the_create_dialog", async () => {
    await mountManage();
    /* 前提：库里一条事项都没有 ⇒ 区进空态，但动作组在场 */
    expect(container?.querySelector(".at-items-zone")?.getAttribute("data-state")).toBe("empty");
    expect(zoneButton(COPY.itemsNewAction), "空态没有「新增」").not.toBeNull();

    act(() => { zoneButton(COPY.itemsNewAction)?.click(); });
    await flush();

    expect(openDialogTitle(), "空态下点「新增」没有弹出任何东西").toBe(COPY.timelineCreateTitle);
  });

  it("tl10_empty_state_manage_opens_its_dialog_and_no_duplicate_edit_entry", async () => {
    await mountManage();
    /* 卡头不再有「编辑事项」：它与点行编辑是同一个动作，重复入口已删 */
    expect(zoneButton(COPY.timelineEditItem), "卡头仍残留「编辑事项」").toBeNull();

    act(() => { zoneButton(COPY.timelineManageItems)?.click(); });
    await flush();
    expect(openDialogTitle(), "空态下点「事项管理」没有弹出任何东西").toBe(COPY.timelineManageItems);
  });

  it("tl11_error_state_entries_are_alive_as_well", async () => {
    /* 读失败（E2）时区里只有错误块，动作组同样在场 —— 一样的坑，一起钉住 */
    h.listTimingItems.mockRejectedValue(new Error("ipc down"));
    await mountManage();
    expect(container?.querySelector(".at-items-zone")?.getAttribute("data-state")).toBe("error");
    act(() => { zoneButton(COPY.itemsNewAction)?.click(); });
    await flush();
    expect(openDialogTitle(), "错误态下点「新增」没有弹出任何东西").toBe(COPY.timelineCreateTitle);
  });
});

describe("今日时间线卡 · 上区「新建待办」在四态之外常驻", () => {
  it("tl12_the_entry_row_survives_loading_and_opens_nothing_by_itself", async () => {
    await mountTimelineCard("loading");
    expect(container?.querySelector(".at-skeleton"), "没进 loading 态（夹具失效）").not.toBeNull();
    expect(todosEntry(), "loading 态没有「新建待办」").not.toBeNull();
    expect(openDialogTitle()).toBeNull();
  });

  it("tl13_the_empty_state_entry_opens_the_compose_dialog", async () => {
    /* 空态（今天一条待办都没有）恰恰是最想新建的时刻：点了必须真的弹出表单 */
    await mountTimelineCard("ready");
    expect(container?.querySelector('[data-zone="todos"] .at-empty')).not.toBeNull();
    act(() => { todosEntry()?.click(); });
    await flush();
    expect(openDialogTitle(), "空态下点「新建待办」没有弹出任何东西").toBe(COPY.todoCreateTitle);
  });

  it("tl14_the_error_state_entry_opens_the_compose_dialog_too", async () => {
    /* 读取失败时更要有"先记下来"的出口：待办写面与读面是两条路 */
    await mountTimelineCard("error");
    expect(container?.querySelector('[data-zone="todos"] .at-module-error')).not.toBeNull();
    expect(todosEntry(), "错误态没有「新建待办」").not.toBeNull();
    act(() => { todosEntry()?.click(); });
    await flush();
    expect(openDialogTitle(), "错误态下点「新建待办」没有弹出任何东西").toBe(COPY.todoCreateTitle);
  });
});
