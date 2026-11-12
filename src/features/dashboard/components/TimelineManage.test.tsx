(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「今日时间线」卡**新建事项**弹层的判据（[本轮] 按主人口径重做）。
 *
 * 为什么必须有这一层：`useItemPrefs` 只管数据收敛、`hostIntentBridge.itemWrite.test.ts`
 * 只管宿主落库，中间这一段 —— 用户实际点的那个弹层 —— 两条链都不覆盖。这里钉四件事：
 *   ① 空名不许提交（按钮 disabled，且不发意图）；
 *   ② 「设为常用」**默认不勾**（新建“可以”加进常用，不是强制）→ 载荷 `isPinned: false` 且
 *      不带 `sortOrder`（建完按 `updatedAt` 自然进「近期事项」组）；勾上 → `isPinned: true` +
 *      `sortOrder`（= 常用组 `max+1`）+ `timerMinutes`；
 *   ③ `emitHostIntent` 返回 false 时**一步都不许推进**：不调 `onLocalCreate`、弹层不关、给一句提示；
 *   ④ 时长非数字输入先拦住，不落到 IPC。
 *
 * 事项管理弹层（两组列表 + 行控件）的判据在 `TimelineManagePrefs.test.tsx`：两个弹层合计
 * 塞一个文件会顶破单文件 300 行的棘轮。**两边的 mock 与查询助手是同一套**（各自写一份，
 * 因为 `vi.mock` 只对声明它的那个测试文件生效）。
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
import TimelineManage, { type TimelineManageMode } from "./TimelineManage.tsx";

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

/** 弹层是 portal 到 body 的，查询也在 body 上做；同一时刻只有一个弹层是打开的 */
const dialog = () => document.body.querySelector<HTMLElement>(".qp-timeline-manage-dialog");
const inputIn = (scope: HTMLElement | null) =>
  scope?.querySelector<HTMLInputElement>("input.qp-timeline-manage-input") ?? null;
const timerIn = (scope: HTMLElement | null) =>
  scope?.querySelector<HTMLInputElement>("input.qp-timeline-manage-timer") ?? null;
const byText = (text: string) =>
  Array.from(dialog()?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? [])
    .find((button) => button.textContent === text);
const statusText = () =>
  Array.from(dialog()?.querySelectorAll('[role="status"]') ?? [])
    .map((node) => node.textContent ?? "")
    .join(" | ");

async function mount(mode: TimelineManageMode) {
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

describe("TimelineManage · 新建事项", () => {
  it("tm01_empty_name_cannot_be_submitted", async () => {
    await mount("create");
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    typeInto(inputIn(dialog()), "   ");
    expect((byText("确认") as HTMLButtonElement).disabled).toBe(true);
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });

  it("tm02_checking_the_pin_box_carries_isPinned_timerMinutes_and_the_next_sortOrder", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 4 })]);
    await mount("create");
    typeInto(inputIn(dialog()), "  看论文  ");
    typeInto(timerIn(dialog()), "25");
    /* 「设为常用」**默认不勾**（口径：新建时“可以”加进常用，不是强制），
       所以要显式勾上才会置顶。 */
    const pinBox = dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
    expect(pinBox.checked).toBe(false);
    act(() => { pinBox.click(); });
    expect(pinBox.checked).toBe(true);
    act(() => { (byText("确认") as HTMLButtonElement).click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "create_item",
      name: "看论文",
      isPinned: true,
      timerMinutes: 25,
      sortOrder: 5, // 常用组里 max(sortOrder)=4 → +1
    });
    expect(onLocalCreate).toHaveBeenCalledWith("看论文");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("tm03_by_default_a_new_item_is_not_pinned_and_carries_no_sortOrder", async () => {
    await mount("create");
    typeInto(inputIn(dialog()), "看论文");
    act(() => { (byText("确认") as HTMLButtonElement).click(); });
    await flush();

    /* 默认不勾 → 普通事项：建完由 `updatedAt` 自然进「近期事项」组，不占常用组的排序位 */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "create_item",
      name: "看论文",
      isPinned: false,
      timerMinutes: null,
    });
    expect((h.emitHostIntent.mock.calls[0]?.[0] as { sortOrder?: number }).sortOrder).toBeUndefined();
  });

  it("tm04_a_failed_emit_does_not_claim_success_and_keeps_the_dialog", async () => {
    h.emitHostIntent.mockResolvedValue(false);
    await mount("create");
    typeInto(inputIn(dialog()), "看论文");
    act(() => { (byText("确认") as HTMLButtonElement).click(); });
    await flush();

    expect(onLocalCreate).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(dialog()).not.toBeNull();
    expect(statusText()).toContain("没发出去");
  });

  it("tm05_a_non_numeric_duration_is_rejected_before_anything_is_emitted", async () => {
    await mount("create");
    typeInto(inputIn(dialog()), "看论文");
    typeInto(timerIn(dialog()), "半小时");
    act(() => { (byText("确认") as HTMLButtonElement).click(); });
    await flush();

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(statusText()).toContain("1–1440");
  });
});

describe("TimelineManage · 焦点契约", () => {
  /* `QuietDialog` 的既有契约：关掉之后焦点回到**触发它的那颗键**。
     入口在卡底 footer 的最末行，「＋ 新建事项 / 事项管理」就在 `TimelineManage` 外面 ——
     新加一层弹层最容易顺手把这条契约打断，而打断了只有键盘用户会发现。 */
  const withOpener = (mode: TimelineManageMode) => createElement(LocaleProvider, {
    locale: "zh-CN",
    children: createElement("div", null,
      createElement("button", { id: "new" }, "＋ 新建事项"),
      createElement(TimelineManage, { mode, onClose, onLocalRename, onLocalCreate })),
  });

  it("tm06_focus_returns_to_the_trigger_button_after_the_dialog_closes", async () => {
    /* 关键顺序：**先**渲染关着的那一版 → 把焦点放到触发键 → 再打开。
       `QuietDialog` 在 open 变 true 时记下 `document.activeElement`，顺序反了就记成 body。 */
    await act(async () => { root?.render(withOpener(null)); });
    const opener = container?.querySelector<HTMLButtonElement>("#new") as HTMLButtonElement;
    act(() => { opener.focus(); });
    expect(document.activeElement).toBe(opener);

    await act(async () => { root?.render(withOpener("create")); });
    await flush();
    expect(dialog()).not.toBeNull();

    await act(async () => { root?.render(withOpener(null)); });
    await flush();
    expect(dialog()).toBeNull();
    expect(document.activeElement).toBe(container?.querySelector("#new"));
  });
});
