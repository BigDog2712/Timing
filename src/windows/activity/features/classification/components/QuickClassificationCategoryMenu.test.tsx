(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 分类子菜单的**渲染层**判据（[本轮]）：
 *   · 内置分类**没有**删除入口（`other` 尤其不能删：它是所有回落的目标）；
 *   · 自定义分类（`custom:` 前缀）才有；
 *   · 「＋ 新建分类」永远在（分类是用户自己的，删光了也要能再建）；
 *   · 点哪一颗就调哪一条回调，且**带上它自己那一行的分类 id**（不要按文案找按钮：
 *     文案在四语言里各一份，钉文案等于把测试绑死在 zh 上）。
 */
import { LocaleProvider } from "../../../shared/i18n/index.ts";
import { loadLocaleText } from "../../../shared/i18n/runtime.ts";
import QuickClassificationCategoryMenu from "./QuickClassificationCategoryMenu.tsx";
import type { QuickClassificationCategoryOption } from "../services/quickClassification.ts";
import type { AppCategory } from "../../../shared/classification/categoryTokens.ts";

const BUILTIN_ONLY: QuickClassificationCategoryOption[] = [
  { value: "browser", label: "浏览" },
  { value: "development", label: "开发" },
  { value: "other", label: "其他" },
];

const WITH_CUSTOM: QuickClassificationCategoryOption[] = [
  ...BUILTIN_ONLY,
  { value: "custom:category_reading", label: "阅读" },
  { value: "custom:category_lab", label: "实验" },
];

interface HarnessProps {
  options: QuickClassificationCategoryOption[];
  currentCategory: AppCategory;
  onPick?: (option: QuickClassificationCategoryOption) => void;
  onCreate?: () => void;
  onDelete?: (category: `custom:${string}`) => void;
}

function Harness({ options, currentCategory, onPick, onCreate, onDelete }: HarnessProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const rootMenuRef = useRef<HTMLDivElement | null>(null);
  return createElement(
    "div",
    { ref: rootMenuRef },
    createElement(QuickClassificationCategoryMenu, {
      menuRef,
      rootMenuRef,
      options,
      currentCategory,
      disabled: false,
      onPick: onPick ?? (() => undefined),
      onCreate: onCreate ?? (() => undefined),
      onDelete: onDelete ?? (() => undefined),
    }),
  );
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function mount(props: HarnessProps): Promise<void> {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(Harness, props),
    }));
  });
  await act(async () => { await Promise.resolve(); });
}

function deleteButtons(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("[data-qp-delete-category]") ?? []);
}

function createButton(): HTMLButtonElement {
  const found = container?.querySelector<HTMLButtonElement>("[data-qp-create-category]");
  if (!found) throw new Error("找不到「＋ 新建分类」");
  return found;
}

function options(): HTMLButtonElement[] {
  return Array.from(container?.querySelectorAll<HTMLButtonElement>("[role='menuitemradio']") ?? []);
}

beforeEach(async () => {
  await loadLocaleText("zh-CN");
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

describe("分类子菜单 · 删除入口只给自定义分类", () => {
  it("m01_builtin_categories_have_no_delete_entry", async () => {
    await mount({ options: BUILTIN_ONLY, currentCategory: "browser" });

    expect(deleteButtons()).toHaveLength(0);
    /* 11 个内置分类一个都不许出现删除键 —— 尤其 `other`（回落目标） */
    expect(container?.querySelector("[data-qp-delete-category='other']")).toBeNull();
    expect(container?.querySelector("[data-qp-delete-category='browser']")).toBeNull();
  });

  it("m02_custom_categories_get_one_delete_entry_each", async () => {
    await mount({ options: WITH_CUSTOM, currentCategory: "browser" });

    const values = deleteButtons().map((button) => button.getAttribute("data-qp-delete-category"));
    expect(values).toEqual(["custom:category_reading", "custom:category_lab"]);
  });

  it("m03_delete_keeps_the_option_list_itself_unchanged", async () => {
    await mount({ options: WITH_CUSTOM, currentCategory: "custom:category_lab" });

    /* 选项列表（`menuitemradio`）与搬家前一模一样：5 条、顺序不变、当前那条 aria-checked */
    const radios = options();
    expect(radios).toHaveLength(WITH_CUSTOM.length);
    expect(radios.map((button) => button.textContent)).toEqual(WITH_CUSTOM.map((option) => option.label));
    expect(radios[4]?.getAttribute("aria-checked")).toBe("true");
  });
});

describe("分类子菜单 · 接线", () => {
  it("m04_clicking_delete_hands_over_that_row_s_own_category_id", async () => {
    const onDelete = vi.fn();
    await mount({ options: WITH_CUSTOM, currentCategory: "browser", onDelete });

    const target = deleteButtons()[1];
    await act(async () => { target?.click(); });

    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(onDelete).toHaveBeenCalledWith("custom:category_lab");
  });

  it("m05_clicking_the_create_entry_calls_onCreate", async () => {
    const onCreate = vi.fn();
    await mount({ options: BUILTIN_ONLY, currentCategory: "browser", onCreate });

    await act(async () => { createButton().click(); });

    expect(onCreate).toHaveBeenCalledTimes(1);
  });

  it("m06_the_create_entry_is_always_there_and_sits_after_the_option_list", async () => {
    await mount({ options: BUILTIN_ONLY, currentCategory: "browser" });

    /* 必须排在所有 `menuitemradio` 之后：`focusMenuItem` 按序号找菜单项，
       插在中间会让"打开时焦点落在当前分类"错位（看起来像勾错了分类）。 */
    const items = Array.from(container?.querySelectorAll<HTMLElement>("[role^='menuitem']") ?? []);
    expect(items[items.length - 1]?.hasAttribute("data-qp-create-category")).toBe(true);
  });

  it("m07_picking_a_category_still_hands_over_the_option_itself", async () => {
    const onPick = vi.fn();
    await mount({ options: BUILTIN_ONLY, currentCategory: "browser", onPick });

    await act(async () => { options()[1]?.click(); });

    expect(onPick).toHaveBeenCalledWith({ value: "development", label: "开发" });
  });
});
