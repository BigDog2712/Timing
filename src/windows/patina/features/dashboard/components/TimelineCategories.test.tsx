(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

/**
 * 「事项分类」（[0.13] 主人反馈：新建事项时能选分类、常用事项也能改分类、分类本身可增删改查）。
 *
 * 判据钉四件事：
 *   ① 新建弹层选中的分类要真的进 `create_item` 载荷（字段名 `categoryKey`，不是 `category`）；
 *   ② 事项管理行上改分类走 `update_item` + `categoryKey`，**选「未分类」时必须发 `null`**
 *      —— 用 `if (value)` 过滤会把"清空分类"整个吞掉：界面回弹、库里不动、零报错；
 *   ③ 行上的分类下拉是"改一条落一条"，不需要进编辑态；
 *   ④ 「管理分类」能把分类管理弹窗打开，且它写成功后分类候选会**重取**（否则刚建的分类型
 *      当场选不到）。分类管理弹窗本身由 `DataCategoryManageDialog` 的测试覆盖，这里只 mock
 *      成一个按钮，验证"打开 + 刷新"这条接线。
 */
interface Item {
  id: number;
  name: string;
  color: string;
  isSystem: boolean;
  isPinned: boolean;
  sortOrder: number;
  updatedAt: number;
  categoryKey: string | null;
}

const h = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
  listTimingItems: vi.fn(async (): Promise<unknown[]> => []),
  getSettings: vi.fn(async (): Promise<unknown> => ({
    itemsTimers: {},
    itemsRecentCount: 5,
    itemsShowRecent: true,
  })),
  /* [0.14] 钩子改读共享层口径的六组原始行，这里按前缀路由 mock。
     labelOverrides 用「键名→覆盖名」描述，beforeEach 展开成带前缀的行。 */
  labelOverrides: {} as Record<string, string>,
  definitionKeys: [] as string[],
  loadSettingRowsByKeyPrefix: vi.fn(async (_prefix: string): Promise<Array<{ key: string; value: string }>> => []),
  loadSettingKeysByKeyPrefix: vi.fn(async (_prefix: string): Promise<Array<{ key: string }>> => []),
}));

vi.mock("../../../platform/runtime/hostIntentGateway.ts", () => ({ emitHostIntent: h.emitHostIntent }));
vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItems: h.listTimingItems,
}));
vi.mock("../../../platform/desktop/hostSettingsGateway.ts", () => ({ getSettings: h.getSettings }));
vi.mock("../../../platform/persistence/activityReminderCatalogGateway.ts", () => ({
  loadActivityReminderCategoryCatalog: vi.fn(async (): Promise<unknown[]> => {
    throw new Error("[0.14] 分类候选已改走共享层 + classificationPersistence，不再读这个网关");
  }),
}));
vi.mock("../../../platform/persistence/classificationPersistence.ts", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  loadSettingRowsByKeyPrefix: h.loadSettingRowsByKeyPrefix,
  loadSettingKeysByKeyPrefix: h.loadSettingKeysByKeyPrefix,
}));
/* 分类管理弹窗：mock 成一个"打开就能触发 onChanged 的按钮"，把真实会话（一整套网关）挡在门外 */
vi.mock("../../data/components/DataCategoryManageDialog.tsx", () => ({
  default: ({ open, onChanged }: { open: boolean; onChanged?: () => void }) => (
    open
      ? createElement("button", { "data-manage-open": "", onClick: () => onChanged?.() }, "manage")
      : null
  ),
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import TimelineManage, { type TimelineManageMode } from "./TimelineManage.tsx";

const item = (id: number, name: string, over: Partial<Item> = {}): Item => ({
  id,
  name,
  color: "",
  isSystem: false,
  isPinned: true,
  sortOrder: id,
  updatedAt: 0,
  categoryKey: null,
  ...over,
});

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let onClose: Mock<() => void>;
let onLocalRename: Mock<(itemId: number, name: string) => void>;
let onLocalCreate: Mock<(name: string) => void>;

const dialog = () => document.body.querySelector<HTMLElement>(".qp-timeline-manage-dialog");
/** 行内那颗分类下拉的触发键（新建弹层里那个也用同一个 class，同一时刻只有一处） */
const categoryTrigger = () =>
  document.body.querySelector<HTMLButtonElement>(".qp-item-category-select .qp-select-trigger");
/**
 * 下拉当前显示的那个 label。
 * ⚠️ 不能用 `trigger.textContent`：`QuietSelect` 把**所有**选项的 label 都渲染进触发键里
 * （靠 CSS 只露出一条），所以触发键的 textContent 永远包含全部选项文本 ——
 * 那样写的断言对"选没选中"完全无感（变异测试会绿着过去）。
 */
const currentLabel = () =>
  document.body.querySelector<HTMLElement>(".qp-item-category-select .qp-select-label-current")?.textContent?.trim() ?? "";
const menuOptions = () => Array.from(document.body.querySelectorAll<HTMLElement>('[role="option"]'));
const optionByText = (text: string) => menuOptions().find((node) => node.textContent?.trim() === text) ?? null;
const typeInto = (input: HTMLInputElement | null, value: string) => {
  const target = input as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(target, value);
    target.dispatchEvent(new Event("input", { bubbles: true }));
  });
};

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

async function pickOption(label: string) {
  const trigger = categoryTrigger();
  if (!trigger) throw new Error("找不到分类下拉");
  await act(async () => { trigger.click(); });
  await flush();
  const option = optionByText(label);
  if (!option) throw new Error(`下拉里没有「${label}」：${menuOptions().map((n) => n.textContent).join("/")}`);
  await act(async () => { option.click(); });
  await flush();
}

beforeEach(() => {
  h.emitHostIntent.mockReset();
  h.emitHostIntent.mockResolvedValue(true);
  h.listTimingItems.mockReset();
  h.listTimingItems.mockResolvedValue([]);
  h.getSettings.mockReset();
  h.getSettings.mockResolvedValue({ itemsTimers: {}, itemsRecentCount: 5, itemsShowRecent: true });
  h.labelOverrides = {};
  h.definitionKeys = [];
  h.loadSettingRowsByKeyPrefix.mockReset();
  h.loadSettingKeysByKeyPrefix.mockReset();
  /* 三档：内置（共享 builder 按固定序全量给出）、自定义（按名字）、未分类（恒在最后）。
     定义行给两个自定义键，labelOverrides 给显示名。 */
  h.definitionKeys = ["custom:category_b", "custom:category_a"];
  h.labelOverrides = { "custom:category_b": "写作", "custom:category_a": "剪辑" };
  h.loadSettingRowsByKeyPrefix.mockImplementation(async (prefix: string) => {
    if (prefix === "__category_label_override::") {
      return Object.entries(h.labelOverrides).map(([key, value]) => ({
        key: `__category_label_override::${key}`,
        value,
      }));
    }
    return [];
  });
  h.loadSettingKeysByKeyPrefix.mockImplementation(async (prefix: string) => {
    if (prefix === "__custom_category::") return h.definitionKeys.map((key) => ({ key: `__custom_category::${key}` }));
    return [];
  });
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
  document.body.innerHTML = "";
});

describe("事项分类 · 候选与顺序", () => {
  it("tc01_下拉里内置在前_自定义按名字排_未分类恒在最后", async () => {
    await mount("create");
    await act(async () => { categoryTrigger()?.click(); });
    await flush();
    /* [0.14] 候选 = 内置十键（共享 builder 固定序）+ 自定义按显示名 zh-CN 序；
       未分类哨兵恒在最后由组件补 —— 这里逐键钉序，漂移即红。 */
    expect(menuOptions().map((node) => node.textContent)).toEqual([
      "未分类", "AI", "开发", "办公", "浏览", "通讯", "视频", "音乐", "游戏", "设计", "工具", "剪辑", "写作",
    ]);
  });
});

describe("事项分类 · 新建事项", () => {
  it("tc02_选中的分类进_create_item_载荷", async () => {
    await mount("create");
    typeInto(dialog()?.querySelector<HTMLInputElement>("input.qp-timeline-manage-input") ?? null, "写周报");
    await pickOption("开发");
    const confirm = Array.from(dialog()?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? [])
      .find((button) => button.textContent === "确认");
    await act(async () => { confirm?.click(); });
    await flush();

    expect(h.emitHostIntent).toHaveBeenCalledWith(expect.objectContaining({
      action: "create_item",
      name: "写周报",
      categoryKey: "development",
    }));
  });

  it("tc03_没选分类时载荷仍显式带_null", async () => {
    await mount("create");
    typeInto(dialog()?.querySelector<HTMLInputElement>("input.qp-timeline-manage-input") ?? null, "写周报");
    const confirm = Array.from(dialog()?.querySelectorAll<HTMLButtonElement>(".qp-dialog-actions button") ?? [])
      .find((button) => button.textContent === "确认");
    await act(async () => { confirm?.click(); });
    await flush();
    expect(h.emitHostIntent).toHaveBeenCalledWith(expect.objectContaining({ categoryKey: null }));
  });

  it("tc04_新建弹层里的管理分类能打开分类管理_写成功后重取候选", async () => {
    await mount("create");
    const manage = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "管理分类");
    expect(manage).toBeTruthy();
    await act(async () => { manage?.click(); });
    await flush();

    const opened = document.body.querySelector<HTMLButtonElement>("[data-manage-open]");
    expect(opened).not.toBeNull();
    const before =
      h.loadSettingRowsByKeyPrefix.mock.calls.length + h.loadSettingKeysByKeyPrefix.mock.calls.length;
    await act(async () => { opened?.click(); });
    await flush();
    /* onChanged → reload：候选必须重取一次，否则刚在管理里建好的分类选不到 */
    expect(
      h.loadSettingRowsByKeyPrefix.mock.calls.length + h.loadSettingKeysByKeyPrefix.mock.calls.length,
    ).toBe(before + 6);
  });
});

describe("事项分类 · 常用事项行", () => {
  it("tc05_常用组行上改分类发_update_item_且带_categoryKey", async () => {
    h.listTimingItems.mockResolvedValue([item(7, "写周报")]);
    await mount("manage");
    await pickOption("办公");
    expect(h.emitHostIntent).toHaveBeenCalledWith(expect.objectContaining({
      action: "update_item",
      id: 7,
      categoryKey: "office",
    }));
  });

  it("tc06_把已有分类改回未分类时发的是_null_而不是不带字段_且本地立刻显示未分类", async () => {
    h.listTimingItems.mockResolvedValue([item(7, "写周报", { categoryKey: "office" })]);
    await mount("manage");
    /* 改之前下拉上必须是「办公」—— 否则下面那句"变成未分类"没有对照，变异测试抓不住 */
    expect(currentLabel()).toBe("办公");

    await pickOption("未分类");
    expect(h.emitHostIntent).toHaveBeenCalledWith(expect.objectContaining({
      action: "update_item",
      id: 7,
      categoryKey: null,
    }));
    /* 本地乐观更新也要认账：`applyLocalItem` 漏了 `categoryKey` 时下拉会弹回「办公」
       （用户看到"点了没反应"），而意图其实已经发出去了 —— 这条断言就是那个缺口。 */
    expect(currentLabel()).toBe("未分类");
  });

  it("tc07_意图没发出去时行上的分类不改_留一句失败提示", async () => {
    h.emitHostIntent.mockResolvedValue(false);
    h.listTimingItems.mockResolvedValue([item(7, "写周报", { categoryKey: "office" })]);
    await mount("manage");
    await pickOption("开发");
    /* 本地不乐观更新：下拉上显示的仍是原分类 */
    expect(currentLabel()).toBe("办公");
    expect(dialog()?.textContent).toContain("没发出去");
  });

  it("tc08_事项管理弹层底部有且只有一个管理分类入口", async () => {
    h.listTimingItems.mockResolvedValue([item(7, "写周报")]);
    await mount("manage");
    const buttons = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .filter((button) => button.textContent === "管理分类");
    expect(buttons).toHaveLength(1);
    await act(async () => { buttons[0]?.click(); });
    await flush();
    expect(document.body.querySelector("[data-manage-open]")).not.toBeNull();
  });
});
