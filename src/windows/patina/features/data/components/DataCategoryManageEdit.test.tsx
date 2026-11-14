(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 改名 / 改色 / 删除的写库判据。
 *
 * 三条全是"点了也照样渲染、但写错就没救"的动作：
 *   · **改名**写 label 覆盖（不是重建定义 —— 重建会换 id，成员全掉）；
 *   · **改色**「恢复默认色」写 `value: null`（删掉覆盖），不是空串、也不是不写；
 *   · **删除**必须**整批**提交：成员回落 + 四条定义清理在同一个事务里。只清定义不清成员
 *     的下场是本仓踩过的坑 —— 被删的自定义分类会因为"还有应用指着它"在下一次 bootstrap
 *     里**原地复活**。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
  commitMutations: vi.fn(async (_mutations: unknown): Promise<void> => undefined),
  loadAppOverrides: vi.fn(),
  loadWebDomainOverrides: vi.fn(),
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
/* 只替掉两条**读**：builder 全走真实现，否则"写了哪几条键"就成了我在测试里自己编的 */
vi.mock("../../classification/services/classificationStore.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadAppOverrides: h.loadAppOverrides, loadWebDomainOverrides: h.loadWebDomainOverrides };
});

import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";
import {
  bootstrapFixture,
  committedRows,
  confirmButton,
  createTestContainer,
  deleteButton,
  manageDialog,
  mount,
  renameButton,
  typedValue,
  typeInto,
  CUSTOM,
} from "./dataCategoryManage.test-utils.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockResolvedValue(bootstrapFixture());
  h.invalidateBootstrapCache.mockReset();
  h.commitMutations.mockReset();
  h.commitMutations.mockResolvedValue(undefined);
  h.loadAppOverrides.mockReset();
  /* code.exe 同时属于 development 与待删的自定义分类：删完之后它必须只剩 development */
  h.loadAppOverrides.mockResolvedValue({
    "code.exe": { category: "development", categories: ["development", CUSTOM], enabled: true, updatedAt: 1 },
  });
  h.loadWebDomainOverrides.mockReset();
  h.loadWebDomainOverrides.mockResolvedValue({});
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

describe("③ 改名 / 改色 / 删除", () => {
  it("cm09_rename_writes_a_label_override_for_that_category", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    const rename = renameButton(CUSTOM);
    expect(rename, "自定义分类没有改名键").not.toBeNull();
    await act(async () => { rename?.click(); });
    await act(async () => { await Promise.resolve(); });
    const input = document.body.querySelector<HTMLInputElement>(".quick-classification-rename-input");
    expect(input, "改名弹窗没打开").not.toBeNull();
    typeInto(input, "课题");
    await act(async () => { await Promise.resolve(); });
    const submit = document.body.querySelector<HTMLButtonElement>("button[form='quick-classification-rename-form']");
    await act(async () => { submit?.click(); });
    await act(async () => { await Promise.resolve(); });

    const rows = committedRows(h.commitMutations);
    expect(rows, `改名写了：${typedValue(h.commitMutations)}`).toHaveLength(1);
    expect(rows[0].key).toBe(`__category_label_override::${CUSTOM}`);
    expect(rows[0].value).toBe("课题");
    /* 改完要重读：列表里那一行的名字得立刻变 */
    expect(h.invalidateBootstrapCache).toHaveBeenCalled();
  });

  it("cm10_reset_color_writes_a_null_override_not_an_empty_string", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    const trigger = manageDialog()?.querySelector<HTMLButtonElement>(
      `[data-category="${CUSTOM}"] .qp-color-trigger`,
    );
    expect(trigger, "分类行没有色块").not.toBeNull();
    await act(async () => { trigger?.click(); });
    await act(async () => { await Promise.resolve(); });
    const reset = document.body.querySelector<HTMLButtonElement>(".qp-color-popover-actions button");
    expect(reset, "色块弹层里没有「恢复默认颜色」").not.toBeNull();
    await act(async () => { reset?.click(); });
    await act(async () => { await Promise.resolve(); });

    const row = committedRows(h.commitMutations).find((item) => item.key.startsWith("__category_color_override::"));
    expect(row, `改色没有写库：${typedValue(h.commitMutations)}`).toBeDefined();
    /* 「恢复默认色」= 删掉这条覆盖（`null`），不是写空串、也不是什么都不做 */
    expect(row?.value).toBeNull();
  });

  it("cm11_delete_is_offered_only_for_custom_categories", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    expect(deleteButton(CUSTOM), "自定义分类没有删除键").not.toBeNull();
    /* 内置 11 类的定义不能删（`other` 更是所有回落的目标） */
    expect(deleteButton("development"), "内置分类不许有删除键").toBeNull();
    expect(deleteButton("design"), "内置分类不许有删除键").toBeNull();
    /* 查：每行的用量读数就是删除影响面 */
    expect(manageDialog()?.querySelector(`[data-category="${CUSTOM}"]`)?.textContent).toContain("1 个在用");
  });

  it("cm12_delete_shows_the_impact_then_writes_member_fallback_and_cleanup_in_one_batch", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    await act(async () => { deleteButton(CUSTOM)?.click(); });
    await act(async () => { await Promise.resolve(); });
    /* 确认框里必须先说清影响面：用量 + "应用会回到「其他」" */
    const surfaces = Array.from(document.body.querySelectorAll<HTMLElement>(".qp-dialog-surface"));
    const confirmSurface = surfaces[surfaces.length - 1];
    expect(confirmSurface?.textContent, "删除确认里没有影响面").toContain("回到「其他」");
    expect(confirmSurface?.textContent).toContain("1 个在用");
    /* 没确认之前一条都不许写 */
    expect(h.commitMutations).not.toHaveBeenCalled();

    await act(async () => { confirmButton()?.click(); });
    await act(async () => { await Promise.resolve(); });

    expect(h.commitMutations, "一次整批提交（不当场分两次）").toHaveBeenCalledTimes(1);
    const written = typedValue(h.commitMutations);
    /* 定义 / 标签 / 默认色分配都清空，并登记进「已删除分类」 */
    expect(written).toContain(`__custom_category::${CUSTOM}=null`);
    expect(written).toContain(`__deleted_category::${CUSTOM}=null`);
    expect(written).toContain(`__category_label_override::${CUSTOM}=null`);
    /* 成员回落：code.exe 还属于 development，所以它不该被整条删掉，而是重算成只剩 development */
    const fallback = committedRows(h.commitMutations).find((row) => row.key.includes("code.exe"));
    expect(fallback, `成员没有回落：${written}`).toBeDefined();
    expect(String(fallback?.value)).not.toContain(CUSTOM);
    expect(String(fallback?.value)).toContain("development");
    expect(h.invalidateBootstrapCache).toHaveBeenCalled();
  });
});
