import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 快捷键分类弹层：**传不传 `itemBinding` 的差别只有那一栏**（0.12.1）。
 *
 * 判据（这是本组测试存在的全部理由）：
 *   1. 不传 → 根菜单仍然是「改名 / 改分类」两项，DOM 里没有「绑定事项」，
 *      也没有任何事项清单 —— 数据页与历史页两处既有调用方零改动的承诺就落在这条上；
 *   2. 传了 → 多一项，点开是「不绑定 + 事项清单」，选中即 `onSave(...)`；
 *   3. 清单读取失败 → 展开显示降级文案，**分类/改名两条路径照旧**（不许因为读不到事项
 *      就把整个弹层按住）。
 *
 * 渲染手法沿用仓内既有口径（没装 `@testing-library/react`）：`createRoot` + `act`。
 * 弹层本体走 `createPortal(document.body)`，所以查询一律打 `document.body`。
 */
const g = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  saveAppOverride: vi.fn(),
}));

vi.mock("../services/classificationService", () => ({
  ClassificationService: {
    loadClassificationBootstrap: g.loadBootstrap,
    saveAppOverride: g.saveAppOverride,
  },
}));

import { LocaleProvider } from "../../../shared/i18n/index.ts";
import { loadLocaleText } from "../../../shared/i18n/runtime.ts";
import QuickClassificationSurface from "./QuickClassificationSurface.tsx";
import {
  createQuickAppClassificationTarget,
  type QuickClassificationItemBinding,
  type QuickClassificationOpenRequest,
} from "../types.ts";

const LABELS: QuickClassificationItemBinding["labels"] = {
  entry: "绑定事项",
  none: "不绑定",
  unbindOnlyHint: "仅解除当前事项的绑定；应用绑定的其他事项不受影响",
  menuLabel: "选择一个事项",
  loadFailed: "暂时读不到事项",
  empty: "还没有事项",
  saveFailed: "保存失败，请重试",
};

const REQUEST: QuickClassificationOpenRequest = {
  target: createQuickAppClassificationTarget({
    exeName: "chrome.exe",
    displayName: "Chrome",
    category: "browser",
  }),
  anchor: { clientX: 120, clientY: 240 },
  returnFocusTo: null,
};

const BOOTSTRAP = {
  observedWebDomains: [],
  loadedOverrides: {},
  loadedWebDomainOverrides: {},
  loadedCategoryColorOverrides: {},
  loadedCategoryLabelOverrides: {},
  loadedPersistedCategoryIds: [],
  loadedDeletedCategories: [],
  loadedAppLinks: {},
};

let container: HTMLDivElement;
let root: Root;

async function mount(itemBinding?: QuickClassificationItemBinding): Promise<void> {
  const onClose = vi.fn();
  const onSaved = vi.fn();
  const onError = vi.fn();
  await act(async () => {
    root.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(QuickClassificationSurface, {
        request: REQUEST,
        onClose,
        onSaved,
        onError,
        itemBinding,
      }),
    }));
    await Promise.resolve();
  });
  await act(async () => { await Promise.resolve(); });
}

function menuItems(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
}

function buttonByText(label: string): HTMLButtonElement {
  const found = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent?.trim() === label);
  if (!found) throw new Error(`找不到「${label}」按钮`);
  return found;
}

beforeEach(async () => {
  (globalThis as unknown as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  await loadLocaleText("zh-CN");
  g.loadBootstrap.mockResolvedValue(BOOTSTRAP);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("弹层：不传 itemBinding 时行为不变", () => {
  it("根菜单仍然只有「改名 / 改分类」两项，DOM 里没有绑定入口", async () => {
    await mount();
    const items = menuItems();
    expect(items).toHaveLength(2);
    expect(items.some((item) => item.textContent?.includes(LABELS.entry))).toBe(false);
    expect(document.body.textContent).not.toContain(LABELS.none);
  });
});

describe("弹层：传了 itemBinding", () => {
  it("多出一栏「绑定事项」，展开能看到「不绑定」与全部事项", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount({
      itemId: 2,
      items: [{ id: 1, name: "写代码" }, { id: 2, name: "开会" }],
      loadFailed: false,
      labels: LABELS,
      onSave,
    });

    expect(menuItems()).toHaveLength(3);
    await act(async () => { buttonByText(LABELS.entry).click(); });

    const options = Array.from(document.body.querySelectorAll<HTMLElement>("[role='menuitemradio']"));
    expect(options).toHaveLength(3);
    expect(options[0]?.textContent).toContain(LABELS.none);
    expect(options[0]?.getAttribute("aria-checked")).toBe("false");
    expect(options[2]?.getAttribute("aria-checked")).toBe("true");
  });

  it("选中即保存：点「不绑定」→ onSave(null)", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount({
      itemId: 2,
      items: [{ id: 2, name: "开会" }],
      loadFailed: false,
      labels: LABELS,
      onSave,
    });

    await act(async () => { buttonByText(LABELS.entry).click(); });
    await act(async () => { buttonByText(LABELS.none).click(); });
    expect(onSave).toHaveBeenCalledWith(null);
  });

  it("清单读不到：只降级这一栏，改名/改分类两项照旧可用", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount({
      itemId: null,
      items: [],
      loadFailed: true,
      labels: LABELS,
      onSave,
    });

    const items = menuItems();
    expect(items).toHaveLength(3);
    expect(items[0]?.disabled).toBe(false);
    expect(items[1]?.disabled).toBe(false);

    await act(async () => { buttonByText(LABELS.entry).click(); });
    expect(document.body.textContent).toContain(LABELS.loadFailed);
    expect(document.body.querySelectorAll("[role='menuitemradio']")).toHaveLength(0);
    expect(onSave).not.toHaveBeenCalled();
  });
});

/**
 * [R6-B 方案 B] 「不绑定」只解除**当前这一事项**：应用还绑着其他事项时，行标记会换成
 * 下一件（拍板保留的现状），但 UI 之前没有解释，用户的误解是「点『不绑定』= 解绑了
 * 整个应用」。修复 = 菜单内、「不绑定」项与事项清单之间加一行**禁用说明**。
 * 断言按 QA 口径钉**逐字原文**：少一个字、换一个分号都是红；文案缺失（labels 没带上
 * `unbindOnlyHint`）时 textContent 为空，同样红。
 */
const UNBIND_ONLY_HINT = "仅解除当前事项的绑定；应用绑定的其他事项不受影响";

describe("弹层：「不绑定」下方的禁用说明行（R6-B）", () => {
  async function openBindingMenu(): Promise<void> {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount({
      itemId: 2,
      items: [{ id: 1, name: "写代码" }, { id: 2, name: "开会" }],
      loadFailed: false,
      labels: LABELS,
      onSave,
    });
    await act(async () => { buttonByText(LABELS.entry).click(); });
  }

  it("说明行逐字钉死原文，且落在「不绑定」与事项清单之间", async () => {
    await openBindingMenu();
    /* 逐字原文（QA 断言口径）：漂移即红 */
    expect(document.body.textContent).toContain(UNBIND_ONLY_HINT);
    /* 位置：子菜单的按钮序列 = 「不绑定」→ 说明行 → 事项清单 */
    const submenu = document.body.querySelector<HTMLDivElement>(
      `[role='menu'][aria-label='${LABELS.menuLabel}']`,
    );
    expect(submenu).not.toBeNull();
    const rows = Array.from(submenu?.querySelectorAll("button") ?? []);
    expect(rows[0]?.textContent).toContain(LABELS.none);
    expect(rows[1]?.textContent).toContain(UNBIND_ONLY_HINT);
    expect(rows[2]?.textContent).toContain("写代码");
    expect(rows[3]?.textContent).toContain("开会");
  });

  it("说明行是禁用菜单项（复用 .quick-classification-menu-item:disabled 的灰字态，零 CSS 改动）", async () => {
    await openBindingMenu();
    const hint = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent?.includes(UNBIND_ONLY_HINT));
    expect(hint).toBeDefined();
    expect(hint?.disabled).toBe(true);
    expect(hint?.className).toContain("quick-classification-menu-item");
    expect(hint?.getAttribute("role")).toBe("menuitem");
    /* 禁用项不进键盘序（`OPTION_SELECTOR` 的 `:not([disabled])` 跳过它） */
    expect(hint?.matches("[role='menuitemradio']")).toBe(false);
  });

  it("文案缺失 → 红：labels 不带 unbindOnlyHint 时说明行不渲染原句", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    await mount({
      itemId: 2,
      items: [{ id: 1, name: "写代码" }],
      loadFailed: false,
      labels: { ...LABELS, unbindOnlyHint: "" },
      onSave,
    });
    await act(async () => { buttonByText(LABELS.entry).click(); });
    expect(document.body.textContent).not.toContain(UNBIND_ONLY_HINT);
  });
});

/**
 * [本轮] 「改分类」子菜单搬到 `QuickClassificationCategoryMenu` 之后，**接线**还得在
 * 弹层这一层再钉一次：选项来自 bootstrap、新建入口在后、内置分类没有删除键。
 * 只测子菜单组件是不够的 —— prop 传错（比如把 `categoryOptions` 漏掉）时
 * 子菜单自己的单测全绿，而这个弹层打开就是一片空白。
 */
describe("弹层：分类子菜单接线", () => {
  it("展开后既有分类可选，也有「＋ 新建分类」，且内置分类没有删除入口", async () => {
    await mount();

    const trigger = menuItems().find((item) => item.getAttribute("aria-haspopup") === "menu");
    expect(trigger).toBeDefined();
    await act(async () => { trigger?.click(); });

    /* 选项来自 `buildQuickClassificationCategoryOptions`（内置 10 个 + 「其他」） */
    const radios = document.body.querySelectorAll("[role='menuitemradio']");
    expect(radios.length).toBeGreaterThan(0);
    /* 新建入口恒在 */
    expect(document.body.querySelector("[data-at-create-category]")).not.toBeNull();
    /* bootstrap 里没有自定义分类 → 一颗删除键都不该有（内置分类不可删） */
    expect(document.body.querySelectorAll("[data-at-delete-category]")).toHaveLength(0);
  });
});
