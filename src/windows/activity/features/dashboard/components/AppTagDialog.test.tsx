import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 应用标签弹窗（[0.12.4]）：已选一行 + 底部「所有标签」选择器。
 *
 * 判据钉的是底部那片选择器 —— 它是这一轮新加的，也是用户提的「底部应缩略显示所有
 * 标签、可以选择所有标签」：
 *   ① 已知标签（定义行 ∪ 事项上用过的）全部铺出来，一个不漏；
 *   ② 点一下加上、再点一下摘掉，顶部的"已选"跟着变（`aria-pressed` 同步）；
 *   ③ 已经选上的那些在底部就是选中态，不会重复加。
 */
const g = vi.hoisted(() => ({
  tags: [] as string[],
  catalog: [] as string[],
  assignments: [] as { itemId: number; tags: string[] }[],
  save: vi.fn(async (_exeName: string, _override: unknown) => undefined),
  createDefinition: vi.fn(async (_path: string) => undefined),
}));

vi.mock("../../../platform/persistence/timingReadRepository.ts", () => ({
  listTimingItemTags: async () => g.assignments,
}));

vi.mock("../../../platform/persistence/tagAdminGateway.ts", () => ({
  listTagDefinitions: async () => g.catalog,
  createTagDefinition: (path: string) => g.createDefinition(path),
}));

vi.mock("../../../shared/classification/appClassification.ts", () => ({
  AppClassification: {
    getAppTags: () => g.tags,
    getUserOverride: () => (g.tags.length ? { tags: g.tags } : null),
  },
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: {
    saveAppOverride: (exeName: string, override: unknown) => g.save(exeName, override),
  },
}));

import AppTagDialog from "./AppTagDialog.tsx";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  g.tags = [];
  g.catalog = [];
  g.assignments = [];
  g.save = vi.fn(async (_exeName: string, _override: unknown) => undefined);
  g.createDefinition = vi.fn(async (_path: string) => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

/** 组件挂载后要等一次 IPC 拉取（`Promise.all`）才有候选 */
async function mount() {
  await act(async () => {
    root.render(createElement(AppTagDialog, {
      exeName: "chrome.exe",
      displayName: "Google Chrome",
      onClose: () => undefined,
    }));
  });
  await act(async () => undefined);
}

/* `QuietDialog` 走 portal 挂到 `document.body`，所以断言都对着 body 而不是容器 */
function pickerChips(): HTMLButtonElement[] {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>(".at-tag-chip"));
}

function pickerChip(tag: string): HTMLButtonElement | undefined {
  return pickerChips().find((chip) => chip.textContent?.replace("✓ ", "") === `#${tag}`);
}

function pressedChips(): string[] {
  return pickerChips()
    .filter((chip) => chip.getAttribute("aria-pressed") === "true")
    .map((chip) => (chip.textContent ?? "").replace("✓ ", ""));
}

describe("应用标签弹窗的所有标签选择器", () => {
  it("at01_lists_every_known_tag_from_definitions_and_item_assignments", async () => {
    g.catalog = ["工作", "学习/考公"];
    g.assignments = [{ itemId: 7, tags: ["学习/考公", "娱乐/燕云"] }];
    await mount();
    /* 定义行与事项上用过的一起铺开，按拼音排（工作 < 学习 < 娱乐） */
    expect(pickerChips().map((chip) => chip.textContent)).toEqual([
      "#工作", "#学习/考公", "#娱乐/燕云",
    ]);
    expect(document.body.textContent).toContain("3 个");
    expect(pressedChips()).toEqual([]);
  });

  it("at02_picking_a_tag_adds_it_and_picking_it_again_removes_it", async () => {
    g.catalog = ["工作"];
    await mount();
    act(() => pickerChip("工作")?.click());
    expect(pressedChips()).toEqual(["#工作"]);
    expect(document.body.textContent).toContain("#工作 ×");

    act(() => pickerChip("工作")?.click());
    expect(pressedChips()).toEqual([]);
    expect(document.body.textContent).not.toContain("#工作 ×");
  });

  it("at03_marks_the_tags_the_app_already_has", async () => {
    g.catalog = ["工作", "学习/考公"];
    g.tags = ["工作"];
    await mount();
    expect(pressedChips()).toEqual(["#工作"]);
    /* 已选的那颗带 `✓` 前缀：只靠底色区分对色弱不友好 */
    expect(pickerChip("工作")?.textContent).toBe("✓ #工作");
  });

  it("at04_explains_how_to_create_the_very_first_tag", async () => {
    await mount();
    expect(pickerChips()).toEqual([]);
    expect(document.body.textContent).toContain("还没有任何标签");
  });
});

/**
 * [2026-11-20] 应用侧新建的标签必须同时落一张定义行。
 *
 * 应用标签只写 `__app_override::<exe>.tags`，而「标签管理」读的是定义行 ∪ 事项引用；
 * 只写 override 的话，用户在应用趋势 / 应用排行里建完标签，去标签管理处永远看不到。
 */
function typeInto(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function saveButton(): HTMLButtonElement | undefined {
  return Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
    .find((button) => button.textContent === "保存");
}

async function save() {
  const target = saveButton();
  await act(async () => { target?.click(); });
  await act(async () => undefined);
}

describe("应用标签弹窗 · 新标签补定义行", () => {
  it("at05_a_new_app_tag_gets_a_definition_before_the_override_is_saved", async () => {
    g.catalog = ["工作"];
    await mount();
    const input = document.body.querySelector<HTMLInputElement>('input[aria-label="应用标签"]');
    typeInto(input as HTMLInputElement, "学习/考公");
    act(() => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    expect(document.body.textContent).toContain("#学习/考公 ×");

    await save();
    expect(g.createDefinition).toHaveBeenCalledTimes(1);
    expect(g.createDefinition).toHaveBeenCalledWith("学习/考公");
    expect(g.save).toHaveBeenCalledTimes(1);
    expect(g.save.mock.calls[0][1]).toEqual({ tags: ["学习/考公"] });
  });

  it("at06_tags_already_in_the_catalog_do_not_create_duplicate_definitions", async () => {
    g.catalog = ["工作"];
    await mount();
    act(() => pickerChip("工作")?.click());
    await save();
    expect(g.createDefinition).not.toHaveBeenCalled();
    expect(g.save).toHaveBeenCalledTimes(1);
    expect(g.save.mock.calls[0][1]).toEqual({ tags: ["工作"] });
  });
});
