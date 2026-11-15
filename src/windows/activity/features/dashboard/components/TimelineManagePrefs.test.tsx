(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「今日时间线」卡**事项管理**弹层的判据（[本轮]）。
 *
 * 这一层是用户诉求的正身：「参考悬浮窗事项菜单的功能」。它自己就有几处错了也照样渲染：
 *   ① 系统事项（`未命名计时` 之类）**不能**出现在常用/近期任何一组里（改名/移出常用会破坏语义，
 *      而 Rust 的 `item_system_protected` 只保护 archive/delete → 只能在这一层挡）；
 *   ② `emitHostIntent` 返回 false（不在 Tauri / emit 失败）时**一步都不许推进本地状态**：
 *      列表不换组、弹层不关、给一句提示；
 *   ③ 「设为／取消常用」的载荷字段（`isPinned`）、上移下移的**两条交换 `sortOrder`**；
 *   ④ 行内就地编辑只提交**真的变了**的字段；Escape 只取消这一行，**不关整个弹层**；
 *   ⑤ `itemsShowRecent === false` 时整组「近期事项」不渲染（宿主的同名开关语义）。
 *
 * 新建事项弹层与焦点契约在 `TimelineManage.test.tsx`（同源的另一份 mock）。
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
  getSettings: vi.fn(async (): Promise<unknown> => ({
    itemsTimers: {},
    itemsRecentCount: 5,
    itemsShowRecent: true,
  })),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import TimelineManage from "./TimelineManage.tsx";

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
let onLocalCreate: Mock<(name: string) => void>;

const dialog = () => document.body.querySelector<HTMLElement>(".qp-timeline-manage-dialog");
const groups = () => Array.from(dialog()?.querySelectorAll(".qp-timeline-prefs-group") ?? []);
const namesIn = (index: number) =>
  Array.from(groups()[index]?.querySelectorAll(".qp-timeline-item-name") ?? [])
    .map((node) => node.textContent);
const byLabel = (label: string) =>
  dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
const statusText = () =>
  Array.from(dialog()?.querySelectorAll('[role="status"]') ?? [])
    .map((node) => node.textContent ?? "")
    .join(" | ");

async function mount(mode: "create" | "manage" | null) {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimelineManage, { mode, onClose, onLocalRename, onLocalCreate }),
    }));
  });
  await flush();
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

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
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({ itemsTimers: {}, itemsRecentCount: 5, itemsShowRecent: true });
  onClose = vi.fn<() => void>();
  onLocalRename = vi.fn<(itemId: number, name: string) => void>();
  onLocalCreate = vi.fn<(name: string) => void>();
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

describe("TimelineManage · 事项管理", () => {
  it("tp01_shows_only_the_pinned_and_recent_groups_and_never_system_items", async () => {
    h.listTimingItems.mockResolvedValue([
      item(1, "未命名计时", { isSystem: true, isPinned: true, sortOrder: 0 }),
      item(2, "写代码", { isPinned: true, sortOrder: 1 }),
      item(7, "开会", { updatedAt: 900 }),
    ]);
    await mount("manage");

    expect(groups()).toHaveLength(2);
    expect(groups()[0].querySelector(".qp-timeline-group-title")?.textContent).toBe("常用事项");
    expect(groups()[1].querySelector(".qp-timeline-group-title")?.textContent).toBe("近期事项");
    expect(namesIn(0)).toEqual(["写代码"]);
    expect(namesIn(1)).toEqual(["开会"]);
    /* 系统事项两组都不列（改名/移出常用会破坏语义） */
    expect(dialog()?.textContent).not.toContain("未命名计时");
  });

  it("tp02_unpinning_emits_isPinned_false_and_keeps_the_item_visible", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount("manage");

    act(() => { (byLabel("取消常用 写代码") as HTMLButtonElement).click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "update_item", id: 2, isPinned: false });
    /* 事项本身保留：从常用组消失、落进近期组，而不是从弹层里消失 */
    expect(namesIn(0)).toEqual([]);
    expect(namesIn(1)).toEqual(["写代码"]);
  });

  it("tp03_moving_up_emits_two_intents_that_swap_the_sortOrders", async () => {
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 10 }),
      item(7, "开会", { isPinned: true, sortOrder: 20 }),
    ]);
    await mount("manage");

    act(() => { (byLabel("上移 开会") as HTMLButtonElement).click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledTimes(2);
    expect(h.emitHostIntent).toHaveBeenNthCalledWith(1, { action: "update_item", id: 7, sortOrder: 10 });
    expect(h.emitHostIntent).toHaveBeenNthCalledWith(2, { action: "update_item", id: 2, sortOrder: 20 });
    /* 本地也换了序：开会现在排在写代码前面 */
    expect(namesIn(0)).toEqual(["开会", "写代码"]);
  });

  it("tp04_a_failed_emit_changes_nothing_locally_and_says_so", async () => {
    h.emitHostIntent.mockResolvedValue(false);
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount("manage");

    act(() => { (byLabel("取消常用 写代码") as HTMLButtonElement).click(); });
    await flush();

    expect(namesIn(0)).toEqual(["写代码"]);
    expect(onClose).not.toHaveBeenCalled();
    expect(statusText()).toContain("没发出去");
    expect(onLocalRename).not.toHaveBeenCalled();
  });

  it("tp05_the_timer_badge_shows_the_default_length_or_count_up", async () => {
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 1 }),
      item(7, "开会", { isPinned: true, sortOrder: 2 }),
    ]);
    h.getSettings.mockResolvedValue({ itemsTimers: { "2": 25 }, itemsRecentCount: 5, itemsShowRecent: true });
    await mount("manage");

    const timers = Array.from(dialog()?.querySelectorAll(".qp-timeline-item-timer") ?? [])
      .map((node) => node.textContent);
    expect(timers).toEqual(["25 分钟", "正计时"]);
  });

  it("tp06_inline_edit_emits_only_the_fields_that_changed", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount("manage");

    act(() => { (byLabel("编辑 写代码") as HTMLButtonElement).click(); });
    const editor = dialog()?.querySelector(".qp-timeline-item-editor") ?? null;
    typeInto(editor?.querySelector("input.qp-timeline-manage-input") ?? null, "重构");
    typeInto(editor?.querySelector("input.qp-timeline-manage-timer") ?? null, "30");
    act(() => {
      (Array.from(editor?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "保存") as HTMLButtonElement).click();
    });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_item",
      id: 2,
      name: "重构",
      timerMinutes: 30,
    });
    expect(onLocalRename).toHaveBeenCalledWith(2, "重构");
    /* 弹层不关：用户常常要连着改几条 */
    expect(onClose).not.toHaveBeenCalled();
  });

  it("tp07_escape_cancels_the_row_edit_only_and_keeps_the_dialog_open", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount("manage");

    act(() => { (byLabel("编辑 写代码") as HTMLButtonElement).click(); });
    const editor = dialog()?.querySelector<HTMLInputElement>(
      ".qp-timeline-item-editor input.qp-timeline-manage-input",
    ) ?? null;
    typeInto(editor, "改了但不想存");
    act(() => {
      editor?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
    });
    await flush();

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()?.querySelector(".qp-timeline-item-name")?.textContent).toBe("写代码");
  });

  it("tp08_the_recent_group_disappears_when_the_host_switch_is_off", async () => {
    h.listTimingItems.mockResolvedValue([item(7, "开会", { updatedAt: 900 })]);
    h.getSettings.mockResolvedValue({ itemsTimers: {}, itemsRecentCount: 5, itemsShowRecent: false });
    await mount("manage");

    expect(groups()).toHaveLength(1);
    expect(dialog()?.textContent).not.toContain("近期事项");
  });

  it("tp09_empty_groups_and_a_read_failure_degrade_visibly", async () => {
    await mount("manage");
    expect(dialog()?.textContent).toContain("还没有常用事项");
    expect(dialog()?.textContent).toContain("还没有近期事项");

    /* 读失败要**重新挂一次**：`useItemPrefs` 有一条刻意的收敛 —— `status` 一旦到过
       `ready`，后续刷新失败**保持 ready**（别把已经显示出来的清单换成一整块错误）。
       所以“第一次就失败”才是错误态的真实入口。 */
    act(() => root?.unmount());
    root = createRoot(container as HTMLDivElement);
    h.listTimingItems.mockRejectedValue(new Error("LIST_ITEMS_FAILED"));
    await mount("manage");
    /* 读失败不许伪装成“没有常用事项” */
    expect(dialog()?.textContent).not.toContain("还没有常用事项");
    expect(statusText()).toBeTruthy();
  });
});
