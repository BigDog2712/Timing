(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 分类管理区「恢复默认颜色」的**接线**判据（[QA 本轮独立复核]）。
 *
 * `DataAppEditCategoryManager` 把「恢复默认颜色」（`RotateCcw`）接到
 * `onApplyColor(category, null)`，写盘侧 `buildSaveCategoryColorOverrideMutations(category, null)`
 * 也确实支持"把覆盖删掉"（写 `value: null`）。断在中间：
 * 宿主把回调写成了
 *
 *     onApplyColor={(category, color) => { if (color) void state.recolorCategory(category, color); }}
 *
 * `if (color)` 把 `null` 过滤掉了 —— 于是用户点「恢复默认颜色」**什么都不发生**，也没有任何提示。
 *
 * ## [本轮] 宿主换成「管理分类」弹窗
 *
 * 这条接线原来挂在 `DataAppEditDialog`（分类管理曾长在它里面）。现在那段搬到了
 * `DataCategoryManageDialog`，所以判据也跟着搬 —— 留在旧宿主上会变成"测一个不存在的
 * 区域"，`querySelector` 返回 null，用例红得莫名其妙（或者更糟：被改成 `if` 判空而永远绿）。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (_exe: string, _override: unknown): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
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
vi.mock("../../../platform/persistence/classificationSettingsGateway.ts", () => ({
  commitClassificationSettingMutations: h.commitMutations,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

async function flush() {
  for (let i = 0; i < 5; i += 1) {
    await act(async () => { await Promise.resolve(); });
  }
}

async function mount() {
  await act(async () => {
    root?.render(createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(DataCategoryManageDialog, { open: true, onClose: () => {} }),
    }));
  });
  await flush();
}

/** 分类行上的第一个色块触发器（限定在分类格栅里：新建行那颗色块没有「恢复默认颜色」） */
function firstColorTrigger(): HTMLButtonElement | null {
  const surface = document.body.querySelector<HTMLElement>(".at-category-manage-dialog");
  return surface?.querySelector<HTMLButtonElement>(".at-category-management-grid .at-color-trigger") ?? null;
}

/** 打开色块弹层后点「恢复默认颜色」（弹层 actions 区的第一颗图标键） */
async function clickReset() {
  await act(async () => { firstColorTrigger()?.click(); });
  await flush();
  const popover = document.body.querySelector<HTMLElement>(".at-color-popover");
  const reset = popover?.querySelector<HTMLButtonElement>(".at-color-popover-actions button");
  await act(async () => { reset?.click(); });
  await flush();
  return { popoverFound: popover !== null, resetFound: reset !== undefined && reset !== null };
}

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockResolvedValue({
    loadedAppLinks: {},
    observedWebDomains: [],
    loadedOverrides: {
      "code.exe": { category: "development", categories: ["development"], displayName: "Code", enabled: true, updatedAt: 1 },
    },
    loadedWebDomainOverrides: {},
    loadedCategoryColorOverrides: {},
    loadedCategoryLabelOverrides: {},
    loadedPersistedCategoryIds: [],
    loadedDeletedCategories: [],
  });
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

describe("分类管理 · 恢复默认颜色", () => {
  it("cr01_the_reset_button_is_reachable_and_rendered", async () => {
    /* 前置条件先自证：色块弹层与「恢复默认颜色」确实挂出来了 —— 否则下面的判据会因为
       "没找到按钮"而变成空转（这类假红比漏测更浪费人）。 */
    await mount();
    expect(firstColorTrigger(), "分类管理区没有色块触发器").not.toBeNull();
    const { popoverFound, resetFound } = await clickReset();
    expect(popoverFound, "色块弹层没打开").toBe(true);
    expect(resetFound, "弹层里没有「恢复默认颜色」键").toBe(true);
  });

  it("cr02_resetting_the_color_writes_a_null_override", async () => {
    /* 期望：一次提交，把该分类的颜色覆盖写空（`value: null` = 回到默认色） */
    await mount();
    await clickReset();
    expect(h.commitMutations).toHaveBeenCalledTimes(1);
    const [mutations] = h.commitMutations.mock.calls[0] as [{ key: string; value: string | null }[]];
    expect(mutations.some((row) => row.key.startsWith("__category_color_override::") && row.value === null)).toBe(true);
  });

  it("cr03_the_reset_also_refreshes_the_category_candidates", async () => {
    /* 写完之后必须重读一次 bootstrap（分类管理区的色块要立刻回到默认色）。
       修之前 `if (color)` 把 null 吃掉：既不写盘、也不重读 —— 点了完全没反应。 */
    await mount();
    expect(h.loadBootstrap, "打开弹窗读过一次").toHaveBeenCalledTimes(1);
    const { resetFound } = await clickReset();
    expect(resetFound).toBe(true);
    expect(h.commitMutations).toHaveBeenCalledTimes(1);
    expect(h.loadBootstrap, "写盘后重新取数").toHaveBeenCalledTimes(2);
    expect(h.invalidateBootstrapCache, "重读前必须作废缓存").toHaveBeenCalled();
  });
});
