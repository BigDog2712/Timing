(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 入口判据：分类 tab 上的「管理分类」，点了确实开弹窗；关着的时候不许读库。
 *
 * 这条为什么必须单独钉：上一轮的分类增删改查**只有**「应用设置」弹窗那一个门 ——
 * 分类 tab 列出了全部分类却对它们什么都做不了。入口不存在，后面所有 CRUD 都无从谈起
 * （那些用例是直接挂弹窗的，测不到"用户能不能走到这里"）。
 *
 * 变异自证：把 `DataCategoryManageEntry` 的 `visible ?` 取反 → cm01 立刻红
 * （应用 tab 上冒出「管理分类」）。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (): Promise<void> => undefined),
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

import DataCategoryManageEntry from "./DataCategoryManageEntry.tsx";
import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";
import {
  bootstrapFixture,
  createTestContainer,
  entryButton,
  manageDialog,
  mount,
} from "./dataCategoryManage.test-utils.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockResolvedValue(bootstrapFixture());
  container = createTestContainer();
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
  document.body.innerHTML = "";
});

describe("① 入口：只有分类 tab 有，点了就开弹窗", () => {
  it("cm01_the_entry_is_a_link_button_that_appears_only_on_the_category_tab", async () => {
    await mount(root!, createElement(DataCategoryManageEntry, {
      visible: false, open: false, onOpen: () => undefined, onClose: () => undefined,
    }));
    expect(entryButton(), "应用 / 网页 tab 上不该有「管理分类」").toBeNull();

    let opened = 0;
    await mount(root!, createElement(DataCategoryManageEntry, {
      visible: true, open: false, onOpen: () => { opened += 1; }, onClose: () => undefined,
    }));
    const button = entryButton();
    expect(button, "分类 tab 上没有「管理分类」入口").not.toBeNull();
    expect(button?.textContent).toBe("管理分类");
    expect(button?.className, "入口是 qp-link-btn（与页面其它文字动作同一档）").toContain("qp-link-btn");
    act(() => button?.click());
    expect(opened, "点了入口没有开弹窗").toBe(1);
  });

  it("cm02_the_entry_opens_the_dialog_and_lists_every_category", async () => {
    /* 入口 → 弹窗的联动靠 `open` 传下去（同一个开关：双击分类行也写它） */
    await mount(root!, createElement(DataCategoryManageEntry, {
      visible: true, open: true, onOpen: () => undefined, onClose: () => undefined,
    }));
    expect(manageDialog(), "入口传的 open 没有把弹窗挂出来").not.toBeNull();
    expect(manageDialog()?.textContent).toContain("我的项目");
    expect(manageDialog()?.textContent).toContain("开发");
  });

  it("cm03_closing_unmounts_the_session_and_never_reads_the_store", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: false, onClose: () => undefined }));
    expect(manageDialog()).toBeNull();
    expect(h.loadBootstrap, "关着的时候不许读库").not.toHaveBeenCalled();
  });

  it("cm04_the_dialog_hint_explains_what_happens_to_deleted_categories", async () => {
    /* 删之前必须说得清"会怎样"：内置分类不能删、被删分类下的应用回到「其他」 */
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    const text = manageDialog()?.textContent ?? "";
    expect(text).toContain("内置分类不能删");
    expect(text).toContain("回到「其他」");
    expect(text).toContain("我的项目");
  });
});
