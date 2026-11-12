(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「今日时间线」写入口的**边界判据**（[QA 独立补测]，与 `TimelineManage*` 两个文件同源 mock）。
 *
 * 补的是主判据里没有、但错了会直接坑用户的那几处：
 *   ① 上移/下移在首行/末行的**禁用**：不禁用会发出把 sortOrder 写成 -1 的意图；
 *   ② 老数据 `sortOrder` 全是 0 的退化路径（`distinct = false` → 用**位置**兜底）。
 *      只交换"两条 sortOrder"的实现在这里等于什么也没做 —— 用户会以为按钮坏了；
 *   ③ 行内编辑把**已设的时长清空** → 必须发 `timerMinutes: null`（= 删键回正计时），
 *      而不是 `undefined`（= 不改，症状是"时长清不掉"）；
 *   ④ 新建成功后「设为常用」必须**复位为不勾**（默认不勾是口径，复位漏了第二次新建
 *      会带上一轮的勾选状态静默置顶）。
 *
 * 为什么要另起文件：两个既有测试文件都已贴住单文件 300 行棘轮。
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

const dialog = () => document.body.querySelector<HTMLElement>(".qp-timeline-manage-dialog");
const groups = () => Array.from(dialog()?.querySelectorAll(".qp-timeline-prefs-group") ?? []);
const namesIn = (index: number) =>
  Array.from(groups()[index]?.querySelectorAll(".qp-timeline-item-name") ?? [])
    .map((node) => node.textContent);
const byLabel = (label: string) =>
  dialog()?.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`) ?? null;
const timersIn = (index: number) =>
  Array.from(groups()[index]?.querySelectorAll(".qp-timeline-item-timer") ?? [])
    .map((node) => node.textContent);

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(mode: TimelineManageMode) {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(TimelineManage, { mode, onClose, onLocalRename, onLocalCreate }),
    }));
  });
  await flush();
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

describe("TimelineManage · 上移下移边界", () => {
  it("te01_the_first_row_cannot_move_up_and_the_last_cannot_move_down", async () => {
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 1 }),
      item(7, "开会", { isPinned: true, sortOrder: 2 }),
    ]);
    await mount("manage");

    expect((byLabel("上移 写代码") as HTMLButtonElement).disabled).toBe(true);
    expect((byLabel("上移 开会") as HTMLButtonElement).disabled).toBe(false);
    expect((byLabel("下移 写代码") as HTMLButtonElement).disabled).toBe(false);
    expect((byLabel("下移 开会") as HTMLButtonElement).disabled).toBe(true);

    /* 禁用按钮点不动 → 一条意图都不该发 */
    act(() => { byLabel("上移 写代码")?.click(); });
    act(() => { byLabel("下移 开会")?.click(); });
    await flush();
    expect(h.emitHostIntent).not.toHaveBeenCalled();
  });

  it("te02_all_zero_sortOrders_fall_back_to_positions_and_still_swap", async () => {
    /* 老数据：常用过但从未重排过 → 两条 sortOrder 都是 0，交换等于没动 */
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 0 }),
      item(7, "开会", { isPinned: true, sortOrder: 0 }),
    ]);
    await mount("manage");
    expect(namesIn(0)).toEqual(["写代码", "开会"]);

    act(() => { (byLabel("上移 开会") as HTMLButtonElement).click(); });
    await flush();

    /* 退化路径：moving → 目标位置(to=0)，other → 原位置(from=1)。
       换个方向（写成对调）会得到 0/0 两条一样的值 —— 顺序不会变，这条就红。 */
    expect(h.emitHostIntent).toHaveBeenNthCalledWith(1, { action: "update_item", id: 7, sortOrder: 0 });
    expect(h.emitHostIntent).toHaveBeenNthCalledWith(2, { action: "update_item", id: 2, sortOrder: 1 });
    expect(namesIn(0)).toEqual(["开会", "写代码"]);
  });

  it("te03_a_failed_second_swap_does_not_roll_back_the_first_one", async () => {
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 1 }),
      item(7, "开会", { isPinned: true, sortOrder: 2 }),
    ]);
    /* 第一条发出去、第二条没发出去 */
    h.emitHostIntent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await mount("manage");

    act(() => { (byLabel("上移 开会") as HTMLButtonElement).click(); });
    await flush();

    /* 已知取舍（没有回执的通道只能这样）：第一笔已发出，本地的 开会 变成 1，
       与 写代码(1) **同权重** → 按 id 兜底仍是 写代码 在前。所以：
         · 界面上"这一下没动"（用户重试即可，不会出现错乱顺序）；
         · 宿主侧 开会 停在 2，下一次刷新也不会跳变（本地 pending 覆盖成 1，还是同权重）。
       这条钉的是"半成功不解体"，不是认可它。 */
    expect(h.emitHostIntent).toHaveBeenCalledTimes(2);
    expect(namesIn(0)).toEqual(["写代码", "开会"]);
  });
});

describe("TimelineManage · 行内编辑的时长三态", () => {
  it("te04_clearing_an_existing_duration_emits_null_and_count_up_shows_again", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    h.getSettings.mockResolvedValue({ itemsTimers: { "2": 25 }, itemsRecentCount: 5, itemsShowRecent: true });
    await mount("manage");
    expect(timersIn(0)).toEqual(["25 分钟"]);

    act(() => { (byLabel("编辑 写代码") as HTMLButtonElement).click(); });
    const editor = dialog()?.querySelector(".qp-timeline-item-editor") ?? null;
    /* 名称不动、只清时长 → 载荷里只能有 timerMinutes: null（`undefined` = 不改 = 清不掉） */
    typeInto(editor?.querySelector("input.qp-timeline-manage-timer") ?? null, "");
    act(() => {
      (Array.from(editor?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "保存") as HTMLButtonElement).click();
    });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledWith({ action: "update_item", id: 2, timerMinutes: null });
    expect(timersIn(0)).toEqual(["正计时"]);
  });

  it("te05_a_non_numeric_duration_in_the_row_editor_is_rejected_before_ipc", async () => {
    h.listTimingItems.mockResolvedValue([item(2, "写代码", { isPinned: true, sortOrder: 1 })]);
    await mount("manage");

    act(() => { (byLabel("编辑 写代码") as HTMLButtonElement).click(); });
    const editor = dialog()?.querySelector(".qp-timeline-item-editor") ?? null;
    typeInto(editor?.querySelector("input.qp-timeline-manage-timer") ?? null, "半小时");
    act(() => {
      (Array.from(editor?.querySelectorAll("button") ?? [])
        .find((button) => button.textContent === "保存") as HTMLButtonElement).click();
    });
    await flush();

    expect(h.emitHostIntent).not.toHaveBeenCalled();
    expect(editor?.textContent).toContain("1–1440");
  });
});

describe("TimelineManage · 设为常用", () => {
  it("te07_pinning_a_recent_item_carries_the_next_sortOrder_and_moves_the_row", async () => {
    h.listTimingItems.mockResolvedValue([
      item(2, "写代码", { isPinned: true, sortOrder: 4 }),
      item(7, "开会", { updatedAt: 900 }),
    ]);
    await mount("manage");
    expect(namesIn(0)).toEqual(["写代码"]);
    expect(namesIn(1)).toEqual(["开会"]);

    act(() => { (byLabel("设为常用 开会") as HTMLButtonElement).click(); });
    await flush();

    /* 载荷必须带 `sortOrder = 常用组 max+1`（4 → 5）。容器少了那一步补位，
       主机侧拿到 `sortOrder: undefined`，事项会被置顶但排在所有常用项之前/之后不可控。 */
    expect(h.emitHostIntent).toHaveBeenCalledWith({
      action: "update_item",
      id: 7,
      isPinned: true,
      sortOrder: 5,
    });
    /* 本地也要换组：从「近期事项」消失、落到「常用事项」末尾 */
    expect(namesIn(0)).toEqual(["写代码", "开会"]);
    expect(namesIn(1)).toEqual([]);
  });
});

describe("TimelineManage · 新建弹层的复位", () => {
  it("te06_the_pin_box_and_inputs_reset_after_a_successful_create", async () => {
    await mount("create");
    typeInto(dialog()?.querySelector("input.qp-timeline-manage-input") ?? null, "看论文");
    typeInto(dialog()?.querySelector("input.qp-timeline-manage-timer") ?? null, "25");
    const pinBox = () => dialog()?.querySelector<HTMLInputElement>('input[type="checkbox"]') as HTMLInputElement;
    act(() => { pinBox().click(); });
    expect(pinBox().checked).toBe(true);

    act(() => {
      (Array.from(dialog()?.querySelectorAll(".qp-dialog-actions button") ?? [])
        .find((button) => button.textContent === "确认") as HTMLButtonElement).click();
    });
    await flush();
    expect(h.emitHostIntent).toHaveBeenCalledTimes(1);

    /* 关掉再打开：上一轮的勾选与草稿都不能残留（否则第二次新建会静默置顶） */
    await mount(null);
    await mount("create");
    expect(pinBox().checked).toBe(false);
    expect((dialog()?.querySelector("input.qp-timeline-manage-input") as HTMLInputElement).value).toBe("");
    expect((dialog()?.querySelector("input.qp-timeline-manage-timer") as HTMLInputElement).value).toBe("");
  });
});
