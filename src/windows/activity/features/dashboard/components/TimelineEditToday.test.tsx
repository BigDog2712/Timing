(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「编辑事项」弹层：候选 = **今日时间线上的事项**（主人口径 2026-11-14）。
 *
 * 上一版候选是全量 `items` 按 `updatedAt` 倒序 —— 库里建过的二十几个（半年前的
 * 「测试」「测试2」「阿萨德」）全在里面，而用户要改的是今天做过的那几件。
 * 这一层自己错了也照样渲染，所以钉三条：
 *   ① 只在 `todayItemIds` 里挑（今天没计过时的事项**不许**出现，即使用了 `updatedAt` 更近）；
 *   ② 顺序 = 时间线顺序（宿主已排好），不再按 `updatedAt` 重排；
 *   ③ 今天时间线为空时给一句能指路的话（不是「还没有常用事项」——那句是管理弹层的）。
 */
interface Item {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
  isPinned: boolean;
  sortOrder: number;
  updatedAt: number;
}

const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  listTimingRecords: vi.fn(async (): Promise<unknown[]> => []),
  listTimingItemTags: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<unknown> => ({
    itemsTimers: {},
    itemsRecentCount: 5,
    itemsShowRecent: true,
  })),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
  listTimingRecords: h.listTimingRecords,
  listTimingItemTags: h.listTimingItemTags,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import { resolveLocaleActivation } from "../../../shared/i18n/runtime.ts";
import TimelineEditDialog from "./TimelineEditDialog.tsx";

const item = (id: number, name: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  color: "",
  isSystem: false,
  isPinned: false,
  sortOrder: 0,
  updatedAt: 0,
  ...over,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: Mock<() => void>;
let onLocalRename: Mock<(itemId: number, name: string) => void>;

const choices = () =>
  Array.from(document.body.querySelectorAll<HTMLButtonElement>(".at-timeline-edit-choice"))
    .map((node) => node.querySelector(".at-timeline-edit-name")?.textContent ?? "");
const dialogText = () => document.body.querySelector(".at-timeline-edit")?.textContent ?? "";

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(todayItemIds: readonly number[]) {
  await resolveLocaleActivation("zh-CN", () => true);
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimelineEditDialog, {
        open: true,
        onClose,
        todayItemIds,
        onLocalRename,
      }),
    }));
  });
  await flush();
  /* 弹层是 portal 到 body 的，挂载点本身在 container 里 */
  await flush();
}

beforeEach(() => {
  h.emitHostIntent.mockClear();
  h.listTimingItems.mockReset();
  h.listTimingRecords.mockReset();
  h.listTimingRecords.mockResolvedValue([]);
  h.listTimingItemTags.mockReset();
  h.listTimingItemTags.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({ itemsTimers: {}, itemsRecentCount: 5, itemsShowRecent: true });
  onClose = vi.fn<() => void>();
  onLocalRename = vi.fn<(itemId: number, name: string) => void>();
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

describe("编辑事项 · 候选范围", () => {
  it("te01_only_items_on_todays_timeline_are_offered", async () => {
    /* 9 是今天做过的；7 / 12 是库里建过的（12 的 updatedAt 最新，上一版会把它排第一） */
    h.listTimingItems.mockResolvedValue([
      item(7, "半年前的测试", { updatedAt: 100 }),
      item(12, "刚建的空事项", { updatedAt: 9999 }),
      item(9, "Timing优化", { updatedAt: 50 }),
    ]);
    await mount([9]);

    expect(choices()).toEqual(["Timing优化"]);
  });

  it("te02_order_follows_the_timeline_not_updated_at", async () => {
    h.listTimingItems.mockResolvedValue([
      item(21, "Timing优化", { updatedAt: 9999 }),
      item(5, "摸鱼", { updatedAt: 1 }),
    ]);
    /* 时间线顺序：早上先摸鱼、下午才做 Timing 优化 */
    await mount([5, 21]);

    expect(choices()).toEqual(["摸鱼", "Timing优化"]);
  });

  it("te03_empty_timeline_points_at_the_create_button", async () => {
    h.listTimingItems.mockResolvedValue([item(7, "半年前的测试", { updatedAt: 100 })]);
    await mount([]);

    expect(choices()).toEqual([]);
    /* 说的必须是"今天的时间线上还没有事项"，而不是管理弹层那句「还没有常用事项」 */
    expect(dialogText()).toContain("今天的时间线上还没有事项");
    expect(dialogText()).not.toContain("常用事项");
  });

  it("te04_system_items_never_appear_even_if_timed", async () => {
    h.listTimingItems.mockResolvedValue([
      item(1, "未归类", { isSystem: true, updatedAt: 100 }),
      item(9, "Timing优化", { updatedAt: 50 }),
    ]);
    await mount([1, 9]);

    expect(choices()).toEqual(["Timing优化"]);
  });

  it("te05_existing_tags_load_into_the_draft_and_new_ones_merge", async () => {
    h.listTimingItems.mockResolvedValue([item(9, "Timing优化")]);
    h.listTimingItemTags.mockResolvedValue([{ itemId: 9, tags: ["工作"] }]);
    await mount([9]);

    act(() => { document.body.querySelector<HTMLButtonElement>(".at-timeline-edit-choice")?.click(); });
    await flush();
    const chips = () => Array.from(document.body.querySelectorAll(".at-item-tag-chip"))
      .map((node) => node.textContent ?? "");
    expect(chips().some((text) => text.includes("工作"))).toBe(true);

    /* 再加一个：保存必须把**原有 + 新增**整组发给宿主（tags 是全量覆盖） */
    const input = document.body.querySelector<HTMLInputElement>(".at-item-tag-input");
    if (!input) throw new Error("标签输入框没渲染");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "新标签");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await flush();
    act(() => {
      document.body.querySelector<HTMLButtonElement>(".at-timeline-item-editor-actions .at-button-primary")?.click();
    });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledWith(expect.objectContaining({
      action: "update_item",
      id: 9,
      tags: ["工作", "新标签"],
    }));
  });
});
