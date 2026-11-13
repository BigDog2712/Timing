(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「应用设置」弹窗的**接线**判据（[本轮]）。
 *
 * 这个弹窗是本轮唯一一处"新开工的写路径"，所以这里不打样式、只打**接线**：
 *   ① 三段（分类 / 事项 / 分类管理）都真的画出来了 —— 少一段就是某次拆文件拆丢了；
 *   ② 打开时读到的 override 会落到勾选上（分类多选 + 事项绑定），主分类带「主」角标；
 *   ③ 只勾一个分类 → 保存键由灭变亮（`canSave` 依赖 dirty），保存写回的 override 里
 *      **`category` = 集合首项**、`itemBindings` **原样保留**（那正是本轮最容易踩的坑）；
 *      并把写回结果再喂进**只改主分类**的补丁（快捷菜单那条路），钉住白名单重建里
 *      "字段未提供 → 沿用当前值"的分支（否则多选集合会被塌成一项）；
 *   ④ 打开前 `app === null` 时什么都不挂（关闭即丢弃草稿靠的就是这个）。
 *
 * 所有 IO 都在边界上 mock 掉：`ClassificationService`（bootstrap + 保存）、事项清单、
 * 设置表提交。组件内部的纯逻辑（草稿、归一）走生产代码。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (_exe: string, _override: unknown): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
  listItems: vi.fn(),
  commitMutations: vi.fn(async (_mutations: unknown): Promise<void> => undefined),
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: {
    loadClassificationBootstrap: h.loadBootstrap,
    invalidateBootstrapCache: h.invalidateBootstrapCache,
    saveAppOverride: h.saveAppOverride,
    saveWebDomainOverride: h.saveWebDomainOverride,
  },
}));
vi.mock("../../dashboard/services/appItemBinding.ts", () => ({
  listAppItemBindingOptions: h.listItems,
}));
vi.mock("../../../platform/persistence/classificationSettingsGateway.ts", () => ({
  commitClassificationSettingMutations: h.commitMutations,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import type { AppOverride } from "../../../shared/classification/processMapper.ts";
import { buildQuickAppOverride } from "../../classification/services/quickClassification.ts";
import DataAppEditDialog from "./DataAppEditDialog.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

const APP = {
  exeName: "code.exe",
  displayName: "Code",
  category: "development" as const,
  iconUrl: undefined,
};

function bootstrapFixture() {
  return {
    loadedAppLinks: {},
    observedWebDomains: [],
    loadedOverrides: {
      "code.exe": {
        category: "development",
        categories: ["development", "design"],
        itemBindings: [{ itemId: 7, category: "design" }],
        displayName: "Code",
        enabled: true,
        updatedAt: 1,
      },
    },
    loadedWebDomainOverrides: {},
    loadedCategoryColorOverrides: {},
    loadedCategoryLabelOverrides: {},
    loadedPersistedCategoryIds: [],
    loadedDeletedCategories: [],
  };
}

async function flush() {
  for (let i = 0; i < 4; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount(
  app: typeof APP | null,
  props: { onClose?: () => void; onSaved?: () => void } = {},
) {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(DataAppEditDialog, {
        app,
        onClose: props.onClose ?? (() => {}),
        onSaved: props.onSaved,
      }),
    }));
  });
  await flush();
}

const surface = () => document.body.querySelector<HTMLElement>(".qp-app-edit-dialog");
const sections = () => Array.from(document.body.querySelectorAll<HTMLElement>(".qp-app-edit-section"));
const categoryRow = (category: string) =>
  document.body.querySelector<HTMLElement>(`.qp-app-edit-option[data-category="${category}"]`);
const itemRow = (itemId: number) =>
  document.body.querySelector<HTMLElement>(`.qp-app-edit-option[data-item-id="${itemId}"]`);
const saveButton = () => Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
  .find((button) => button.textContent === "保存");

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockResolvedValue(bootstrapFixture());
  h.invalidateBootstrapCache.mockReset();
  h.saveAppOverride.mockReset();
  h.saveAppOverride.mockResolvedValue(undefined);
  h.listItems.mockReset();
  h.listItems.mockResolvedValue([{ id: 7, name: "写代码", color: "" }, { id: 9, name: "看论文", color: "" }]);
  h.commitMutations.mockReset();
  h.commitMutations.mockResolvedValue(undefined);
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

describe("DataAppEditDialog", () => {
  it("ae01_renders_nothing_while_no_app_is_selected", async () => {
    await mount(null);
    expect(surface()).toBeNull();
  });

  it("ae02_draws_the_three_sections_and_marks_the_primary_category", async () => {
    await mount(APP);
    expect(surface()).not.toBeNull();
    expect(sections()).toHaveLength(3);
    /* 落库态落到勾选上：development 是主分类（带「主」角标），design 也勾着 */
    expect(categoryRow("development")?.hasAttribute("data-primary")).toBe(true);
    expect(categoryRow("development")?.textContent).toContain("主");
    expect(categoryRow("design")?.hasAttribute("data-checked")).toBe(true);
    expect(categoryRow("office")?.hasAttribute("data-checked")).toBe(false);
    /* 事项：7 已绑定并带归属分类，9 未绑定 */
    expect(itemRow(7)?.hasAttribute("data-checked")).toBe(true);
    expect(itemRow(9)?.hasAttribute("data-checked")).toBe(false);
  });

  it("ae03_saving_promotes_the_new_primary_and_keeps_the_item_bindings", async () => {
    await mount(APP);
    /* 没改动时保存键是灭的 */
    expect(saveButton()?.disabled).toBe(true);

    const checkbox = categoryRow("office")?.querySelector<HTMLInputElement>("input[type='checkbox']");
    await act(async () => { checkbox?.click(); });
    await flush();
    expect(saveButton()?.disabled).toBe(false);

    await act(async () => { saveButton()?.click(); });
    await flush();

    expect(h.saveAppOverride).toHaveBeenCalledTimes(1);
    const [, saved] = h.saveAppOverride.mock.calls[0] as [string, AppOverride];
    /* 这一段走的是"补丁里**带全**三个字段"的分支 —— `buildDraftAppOverride` 恒传
       `category` / `categories` / `itemBindings`（原因见它的注释：不传 categories 就会
       走"用当前值回落"，取消勾选全部分类时会被补回来）。 */
    expect(saved.category).toBe("development");
    expect(saved.categories).toEqual(["development", "design", "office"]);
    /* 只改分类，事项绑定必须原样活着 */
    expect(saved.itemBindings).toEqual([{ itemId: 7, category: "design" }]);

    /* 真判据（补 QA 指出的假绿）：上面那段**永远不会**走到白名单重建里"字段未提供 →
       沿用当前值"的分支，所以它挡不住那条分支被改坏。这里把弹窗刚写出来的 override
       再喂进**只改主分类**的路径（快捷菜单只传 `{ category }`，不带 categories /
       itemBindings），集合一旦被塌成一项就是那条分支坏了 —— 变异自证见本轮交付说明。 */
    const repromoted = buildQuickAppOverride(saved, { category: "office" }, 9);
    expect(repromoted?.category, "只改主分类：把它提为集合首项").toBe("office");
    expect(repromoted?.categories, "只改主分类不许把多选集合塌成一项")
      .toEqual(["office", "development", "design"]);
    expect(repromoted?.itemBindings, "只改主分类不许动事项绑定")
      .toEqual([{ itemId: 7, category: "design" }]);
  });

  it("ae04_a_failed_read_keeps_the_save_button_dead", async () => {
    /* 读失败 → 空草稿；这时候允许保存等于把用户既有配置整段抹平 */
    h.loadBootstrap.mockRejectedValue(new Error("boom"));
    await mount(APP);
    expect(saveButton()?.disabled).toBe(true);
    expect(document.body.querySelector(".qp-app-edit-issue")?.textContent).toBe("读取这个应用的设置失败");
  });

  it("ae05_a_successful_save_notifies_onSaved_before_closing", async () => {
    /* [修复 D-7] 保存成功后必须给上层一个"该重新取数了"的信号，否则趋势列表里那一行的
       分类标记停在旧值，用户会以为没存上（页面把 `onSaved` 接到既有刷新路径 `onRetry`）。 */
    const order: string[] = [];
    await mount(APP, {
      onSaved: () => order.push("saved"),
      onClose: () => order.push("closed"),
    });
    const checkbox = categoryRow("office")?.querySelector<HTMLInputElement>("input[type='checkbox']");
    await act(async () => { checkbox?.click(); });
    await flush();
    await act(async () => { saveButton()?.click(); });
    await flush();

    expect(h.saveAppOverride).toHaveBeenCalledTimes(1);
    /* 先通知重读、再关弹窗（关掉之后再刷新会让用户看不到保存结果） */
    expect(order).toEqual(["saved", "closed"]);
  });

  it("ae06_the_trend_panel_wires_onSaved_to_its_existing_retry", async () => {
    /* 结构性判据：弹窗的 `onSaved` 必须落到面板既有的重新取数入口（`onRetry`），
       不是只留一个没人接的口子。 */
    const source = readFileSync("src/windows/patina/features/data/components/DataAppTrendPanel.tsx", "utf8");
    expect(source, "面板没把 onSaved 接上 → 保存后列表不刷新").toContain("onSaved={onRetry}");
    expect(source, "onRetry 必须是面板的入参（既有刷新路径，不新开 IPC）").toContain("onRetry");
  });
});
