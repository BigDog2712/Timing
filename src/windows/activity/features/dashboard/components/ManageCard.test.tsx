(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「事项管理」**独立卡**（0.12.6）的卡壳判据 —— 原 `ItemsCard.test.tsx` 的覆盖点搬到这里。
 *
 * 两件事必须由这一层钉住（纯函数与 hook 单测都看得见不到）：
 *   ① **卡壳本身**：卡头标题来自 props（改名后跟着变）、区标题是「常用与历史」、
 *      区根节点带 `data-zone="manage"`；
 *   ② **三颗动作在四态之外常驻**：新增 / 事项管理 / 一键 AI 分类。卡头**没有**「编辑事项」
 *      —— 点行就是编辑，重复入口已删。动作挂在区标题行里，而"库里还没有任何事项"（空态）
 *      与"读失败"（错误态）恰恰是最需要点「新增」的时刻 —— 把动作塞进 ready 分支，
 *      这两种状态下入口就是死链，零报错、零提示。
 *
 * 单击/长按都不该"看起来生效"：起停方向由 `useItemTimerToggle` 判，这里只传 `ItemTimerToggle`
 * 桩，判的是"点了有没有把 id 与名字交上去"以及"行尾圆点画成哪一种颜色状态"。圆点三种
 * 状态（灰 / 蓝 / 黄）由 `data-timer-state` 落到行上；正在计别的条时点它先弹「是否切换」。
 *
 * V-1.6c（「编辑事项」弹层保存 = 恰一条 `update_item`）随入口从时间线卡搬来本册：
 * 那颗入口现在住在本卡的区标题行里，`TimelineCardR2.test.tsx` 已经挂不到它。
 */
const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent?: unknown): Promise<boolean> => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingRecords: vi.fn(async (): Promise<unknown[]> => []),
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<Record<string, unknown>> => ({})),
  /** 绑定表：`exeName → 并集`。空对象 = 一个都没绑 */
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
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));
vi.mock("../../../platform/desktop/hostAiGateway.ts", () => ({
  aiConfigGet: h.aiConfigGet,
  aiSuggestTags: h.aiSuggestTags,
}));
vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  listTagDefinitions: h.listTagDefinitions,
  createTagDefinition: h.createTagDefinition,
}));
/* 绑定：读的是"1:1 ∪ override"的并集（`useAppItemBindings`），这里只给其中一份夹具。
   `appItemBinding.ts` 里还有纯函数（`resolveAppItemBindingExe`）被「编辑事项」弹层的
   绑定栏用到，所以要一并给出去，否则那一栏一挂载就是 `undefined is not a function`。 */
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
import type { TodoSummary } from "../../../shared/types/todos.ts";
import { DASHBOARD_COPY } from "../copy.ts";
import type { TodayItemRow } from "../hooks/useTodayItems.ts";
import ManageCard, {
  NO_MANAGE_ACTIONS,
  type ManageCardActions,
  type ManageCardModel,
} from "./ManageCard.tsx";

const COPY = DASHBOARD_COPY["zh-CN"];
const HOUR = 3_600_000;

function item(id: number, name: string, over: Partial<TodayItemRow> = {}): TodayItemRow {
  return {
    itemId: id,
    name,
    color: "",
    value: 40 * 60_000,
    firstStart: Date.now() - 2 * HOUR,
    lastEnd: null,
    segments: 1,
    ...over,
  };
}

const ITEM_A = item(11, "写周报");
const ITEM_B = item(12, "记账", { value: 0, segments: 0 });

/** 事项管理的读侧模型：本卡只用到"行 + 两个已发出先本地生效的回执" */
function model(rows: TodayItemRow[] = []): ManageCardModel {
  return {
    rows,
    applyLocalRename: () => undefined,
    applyLocalCreate: () => undefined,
  };
}

const toggleItem = vi.fn();
const noopToast = (): void => undefined;

/** 可观测的起停桩：默认空闲，个别用例覆盖成"正在计某一条" */
function actions(over: Partial<ManageCardActions> = {}): ManageCardActions {
  return {
    itemTimer: { status: "idle", sessionItemId: null, toggleItem },
    onToast: noopToast,
    ...over,
  };
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

interface MountOptions {
  title?: string;
  todayItems?: ManageCardModel;
  todos?: readonly TodoSummary[];
  actions?: ManageCardActions;
}

async function mount(over: MountOptions = {}) {
  await resolveLocaleActivation("zh-CN", () => true);
  act(() => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(ManageCard, {
        title: COPY.cardLabels.manage,
        todayItems: model(),
        actions: NO_MANAGE_ACTIONS,
        ...over,
      }),
    }));
  });
  await flush();
}

const zone = () => container?.querySelector<HTMLElement>(".at-items-zone") ?? null;
const zoneTitle = () => container?.querySelector(".at-items-zone-title")?.textContent ?? "";
const actionLabels = () =>
  Array.from(container?.querySelectorAll<HTMLButtonElement>(".at-items-zone-actions button") ?? [])
    .map((button) => (button.textContent ?? "").trim());
const rows = () => Array.from(container?.querySelectorAll<HTMLElement>(".at-items-row") ?? []);
const rowOf = (name: string) =>
  rows().find((row) => row.querySelector(".at-items-row-name")?.textContent === name) ?? null;
const surfaceText = () => document.body.querySelector(".at-dialog-surface")?.textContent ?? "";
const byText = (text: string) =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => (button.textContent ?? "").trim() === text);

/** 受控输入：必须走原生 setter，否则 React 的 value tracker 认不出变化 */
function typeInto(input: HTMLInputElement | null, value: string) {
  const target = input as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  toggleItem.mockReset();
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([
    { id: 11, name: "写周报", color: "", isSystem: false, isPinned: true, sortOrder: 1, updatedAt: 5 },
    { id: 12, name: "记账", color: "", isSystem: false, isPinned: false, sortOrder: 2, updatedAt: 9 },
  ]);
  h.listTimingRecords.mockReset();
  h.listTimingRecords.mockResolvedValue([]);
  h.listTimingItemTags.mockReset();
  h.listTimingItemTags.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({});
  h.loadAppItemBindingUnions.mockReset();
  h.loadAppItemBindingUnions.mockResolvedValue({});
  h.mirrorItemBindingsOnce.mockReset();
  h.listAppItemBindingOptions.mockReset();
  h.listAppItemBindingOptions.mockResolvedValue([]);
  h.saveAppItemBinding.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  /* 弹层 portal 到 body：卸载不会带走它们（`QuietDialog` 只在关闭时自己摘） */
  document.body.querySelectorAll(".at-dialog-backdrop").forEach((node) => node.remove());
});

describe("事项管理卡 · 卡壳", () => {
  it("mc01_the_card_head_shows_the_title_given_by_props", async () => {
    await mount({ title: "上午的事" });
    expect(container?.querySelector(".at-card-title")?.textContent).toBe("上午的事");
    /* 改名后标题要跟着变（标题由布局层的 `displayTitle` 算好传进来，卡内不自己拼） */
    await mount({ title: "下午的事" });
    expect(container?.querySelector(".at-card-title")?.textContent).toBe("下午的事");
  });

  it("mc02_the_zone_title_is_the_frequent_and_past_groups_heading", async () => {
    await mount({ todayItems: model([ITEM_A]) });
    expect(zoneTitle()).toBe(COPY.itemsManageTitle);
    /* 卡头标题与区标题**不是同一个字符串**：卡叫「事项管理」，区叫「常用与历史」 */
    expect(container?.querySelector(".at-card-title")?.textContent).not.toBe(zoneTitle());
    /* 区根节点带 `data-zone="manage"`：与时间线卡的 `todos` / `timeline` 区分 */
    expect(zone()?.getAttribute("data-zone")).toBe("manage");
  });
});

describe("事项管理卡 · 三颗动作在四态之外常驻", () => {
  const EXPECTED = [COPY.itemsNewAction, COPY.timelineManageItems, COPY.itemsAiTag];

  it("mc03a_ready_state_shows_all_three", async () => {
    await mount({ todayItems: model([ITEM_A, ITEM_B]) });
    expect(zone()?.getAttribute("data-state")).toBe("ready");
    expect(actionLabels()).toEqual(EXPECTED);
  });

  it("mc03b_empty_state_keeps_the_actions", async () => {
    /* 一条事项都没有时，「新增」是最该被点的那颗 —— 藏进 ready 分支就等于没做 */
    h.listTimingItems.mockResolvedValue([]);
    await mount();
    expect(zone()?.getAttribute("data-state")).toBe("empty");
    expect(actionLabels()).toEqual(EXPECTED);
  });

  it("mc03c_error_state_keeps_the_actions", async () => {
    h.listTimingItems.mockRejectedValue(new Error("ipc down"));
    await mount();
    expect(zone()?.getAttribute("data-state")).toBe("error");
    expect(actionLabels()).toEqual(EXPECTED);
  });
});

describe("事项管理卡 · 行", () => {
  it("mc04_clicking_a_row_opens_the_item_editor_instead_of_starting_the_timer", async () => {
    await mount({ todayItems: model([ITEM_A, ITEM_B]), actions: actions() });
    act(() => { rowOf("写周报")?.querySelector<HTMLButtonElement>(".at-items-row-main")?.click(); });
    await flush();
    /* 用户口径：点事项 = 编辑它；起停挪到行尾那颗键 */
    expect(toggleItem).not.toHaveBeenCalled();
    expect(document.body.querySelector(".at-timeline-edit"), "点击行没有打开编辑弹层").not.toBeNull();
  });

  it("mc04b_the_row_tail_dot_toggles_the_timer", async () => {
    await mount({ todayItems: model([ITEM_A, ITEM_B]), actions: actions() });
    act(() => { rowOf("写周报")?.querySelector<HTMLButtonElement>(".at-items-row-timer")?.click(); });
    /* 名字一起交上去：宿主成功后的提示条要念出是哪一条 */
    expect(toggleItem).toHaveBeenCalledWith(11, "写周报");
    /* 行尾是一个圆点，不再是播放/停止图标 */
    expect(rowOf("写周报")?.querySelector(".at-items-row-timer .at-items-row-dot")).not.toBeNull();
  });

  it("mc05_only_the_running_item_is_blue", async () => {
    await mount({
      todayItems: model([ITEM_A, ITEM_B]),
      actions: actions({ itemTimer: { status: "running", sessionItemId: 11, toggleItem } }),
    });
    expect(rowOf("写周报")?.getAttribute("data-timer-state"), "正在计的那一行不是蓝点").toBe("running");
    expect(rowOf("记账")?.getAttribute("data-timer-state"), "别的行也被画成正在计时").toBe("idle");
    expect(container?.querySelectorAll('.at-items-row[data-timer-state="running"]')).toHaveLength(1);
  });

  it("mc05b_a_paused_session_is_yellow_not_blue", async () => {
    /* 暂停中的会话也"挂在"这一条上，但点它的语义是**继续** —— 画成正在计时就是撒谎 */
    await mount({
      todayItems: model([ITEM_A]),
      actions: actions({ itemTimer: { status: "paused", sessionItemId: 11, toggleItem } }),
    });
    expect(rowOf("写周报")?.hasAttribute("data-running")).toBe(false);
    expect(rowOf("写周报")?.getAttribute("data-timer-state")).toBe("pending");
  });

  it("mc05c_a_pending_same_name_todo_turns_the_dot_yellow_and_blue_wins", async () => {
    const todo: TodoSummary = {
      id: 1,
      title: "写周报",
      plannedAt: null,
      remindAt: null,
      doneAt: null,
      sortOrder: 0,
    };
    await mount({ todayItems: model([ITEM_A, ITEM_B]), todos: [todo] });
    expect(rowOf("写周报")?.getAttribute("data-timer-state"), "有未完成待办却不黄").toBe("pending");
    expect(rowOf("记账")?.getAttribute("data-timer-state")).toBe("idle");

    /* 正在计时时蓝点优先：黄点只是"这条还有待办"，不能盖掉"正在计" */
    await mount({
      todayItems: model([ITEM_A, ITEM_B]),
      todos: [todo],
      actions: actions({ itemTimer: { status: "running", sessionItemId: 11, toggleItem } }),
    });
    expect(rowOf("写周报")?.getAttribute("data-timer-state")).toBe("running");
  });

  it("mc05d_a_dot_on_another_item_while_timing_asks_before_switching", async () => {
    await mount({
      todayItems: model([ITEM_A, ITEM_B]),
      actions: actions({ itemTimer: { status: "running", sessionItemId: 11, toggleItem } }),
    });
    act(() => { rowOf("记账")?.querySelector<HTMLButtonElement>(".at-items-row-timer")?.click(); });
    await flush();

    /* 还没确认：一条意图都不许发 */
    expect(toggleItem).not.toHaveBeenCalled();
    expect(surfaceText()).toContain(COPY.itemsSwitchTitle);

    act(() => { byText(COPY.itemsSwitchAction)?.click(); });
    await flush();
    expect(toggleItem).toHaveBeenCalledWith(12, "记账");
  });

  it("mc05e_cancelling_the_switch_keeps_the_current_timer", async () => {
    await mount({
      todayItems: model([ITEM_A, ITEM_B]),
      actions: actions({ itemTimer: { status: "running", sessionItemId: 11, toggleItem } }),
    });
    act(() => { rowOf("记账")?.querySelector<HTMLButtonElement>(".at-items-row-timer")?.click(); });
    await flush();
    act(() => { byText("取消")?.click(); });
    await flush();
    expect(toggleItem).not.toHaveBeenCalled();
  });

  it("mc06_an_item_with_a_bound_app_carries_the_bound_mark", async () => {
    h.loadAppItemBindingUnions.mockResolvedValue({
      "code.exe": { oneToOne: 11, itemIds: [11], trackOff: false },
    });
    await mount({ todayItems: model([ITEM_A, ITEM_B]) });
    const marked = rowOf("写周报")?.querySelector(".at-items-row-bound");
    expect(marked?.getAttribute("aria-label")).toBe(COPY.itemsBoundMark);
    expect(rowOf("记账")?.querySelector(".at-items-row-bound"), "没绑的行也画了标记").toBeNull();
  });
});

describe("事项管理卡 · 空态与错误态", () => {
  it("mc07_an_empty_library_says_how_to_create_the_first_item", async () => {
    h.listTimingItems.mockResolvedValue([]);
    await mount();
    expect(container?.querySelector(".at-empty")?.textContent).toBe(COPY.itemsEmpty);
  });

  it("mc08_the_error_state_retry_reloads_the_prefs_source", async () => {
    h.listTimingItems.mockRejectedValueOnce(new Error("ipc down"));
    await mount();
    expect(container?.querySelector(".at-module-error"), "读失败却没有错误块").not.toBeNull();
    expect(h.listTimingItems).toHaveBeenCalledTimes(1);

    /* 重试必须真的再读一次（`useItemPrefs.reload`）；只把文案换掉的话用户会以为好了 */
    act(() => {
      container?.querySelector<HTMLButtonElement>(".at-module-error .at-link-btn")?.click();
    });
    await flush();
    expect(h.listTimingItems).toHaveBeenCalledTimes(2);
    expect(container?.querySelector(".at-module-error")).toBeNull();
  });
});

describe("事项管理卡 · 行点击编辑（V-1.6c）", () => {
  it("mc09_row_click_edit_save_emits_exactly_one_update_item_intent", async () => {
    await mount({ todayItems: model([ITEM_A, ITEM_B]), actions: actions() });
    /* 唯一入口是点行：卡头那颗重复的「编辑事项」已经删了 */
    act(() => { rowOf("写周报")?.querySelector<HTMLButtonElement>(".at-items-row-main")?.click(); });
    await flush();
    expect(surfaceText(), "点行没有弹出编辑弹层").not.toBe("");

    const nameInput = document.body.querySelector<HTMLInputElement>(
      ".at-timeline-manage-dialog input.at-timeline-manage-input",
    );
    expect(nameInput?.value).toBe("写周报");
    typeInto(nameInput, "写周报（上午）");

    act(() => { byText("确认")?.click(); });
    await flush();

    /* 恰一条意图；`timerMinutes` 显式发（留空 = null = 清默认时长） */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_item",
      id: 11,
      name: "写周报（上午）",
      timerMinutes: null,
    });
  });
});
