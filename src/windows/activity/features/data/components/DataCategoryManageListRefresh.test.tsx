(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
// @ts-expect-error 同上：仅测试进程用得到 node:path。
import { dirname, join } from "node:path";
// @ts-expect-error 同上：仅测试进程用得到 node:url。
import { fileURLToPath } from "node:url";

/**
 * [QA 补测] 改名 / 改色 / 删除之后的**可见行**（不是"有没有调 invalidate 缓存"）。
 *
 * 为什么必须补：`DataCategoryManageEdit.test.tsx` 对这三个动作只断言了"写了哪几条 mutation"
 * 与"作废了缓存"，而 `invalidateBootstrapCache()` 被调用**不等于**列表会跟着变 ——
 * 上一轮 `DataAppEditDialog` 正是栽在"写了库不重读"（保存后列表停在旧值）。
 * 这里搭一个**假库**（提交写进 fixture，下一次读把结果带回来），断言的是 DOM：
 *   · 改名后那一行的名字变了；
 *   · 改色后那一行还在，**色块本身变成新颜色**（只钉"重读发生了 + 行没丢"是不够的：
 *     色块是这一行唯一的可见颜色信号，重读后没换色等于用户改了白改）；
 *   · 删除后那一行**消失**，内置分类一个不少。
 * 三条都同时核 `onChanged`（页面重取数信号）恰好一次。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
  commitMutations: vi.fn(async (_mutations: unknown): Promise<void> => undefined),
  /* 删除的成员回落走可恢复 propagation（真 IPC）：jsdom 没有 `__TAURI_INTERNALS__`，
     不替掉就会在 commit 之前抛错，表现为"删了但那一行还在"的假红。 */
  propagate: vi.fn(async (_mapping: Record<string, string | null>) => ({ conflicts: [] })),
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
vi.mock("../../../platform/persistence/categoryPropagationGateway.ts", () => ({
  propagateCategoryMapping: h.propagate,
  CategoryPropagationConflictError: class extends Error {},
}));
/* 只替掉两条**读**：写库的 builder 全走真实现 */
vi.mock("../../classification/services/classificationStore.ts", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, loadAppOverrides: h.loadAppOverrides, loadWebDomainOverrides: h.loadWebDomainOverrides };
});

import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";
import {
  CUSTOM,
  bootstrapFixture,
  categoryRow,
  committedRows,
  confirmButton,
  createTestContainer,
  deleteButton,
  flush,
  manageDialog,
  mount,
  renameButton,
  typeInto,
} from "./dataCategoryManage.test-utils.tsx";

type Fixture = ReturnType<typeof bootstrapFixture>;
type MutationRow = { key: string; value: string | null };

const DEFINITION_PREFIX = "__custom_category::";
const LABEL_PREFIX = "__category_label_override::";
const COLOR_PREFIX = "__category_color_override::";

/** 假库：把一次提交按前缀落进 fixture（下一次 `loadClassificationBootstrap` 就带回来） */
function applyToFixture(fixture: Fixture, mutations: MutationRow[]): void {
  const persistedIds = fixture.loadedPersistedCategoryIds as string[];
  const labels = fixture.loadedCategoryLabelOverrides as Record<string, string | null>;
  const colors = fixture.loadedCategoryColorOverrides as Record<string, string | null>;
  for (const { key, value } of mutations) {
    if (key.startsWith(DEFINITION_PREFIX)) {
      const id = key.slice(DEFINITION_PREFIX.length);
      if (value === null) {
        const at = persistedIds.indexOf(id);
        if (at >= 0) persistedIds.splice(at, 1);
      } else if (!persistedIds.includes(id)) {
        persistedIds.push(id);
      }
    } else if (key.startsWith(LABEL_PREFIX)) {
      labels[key.slice(LABEL_PREFIX.length)] = value;
    } else if (key.startsWith(COLOR_PREFIX)) {
      colors[key.slice(COLOR_PREFIX.length)] = value;
    }
  }
}

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let fixture: Fixture;

beforeEach(() => {
  fixture = bootstrapFixture();
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockImplementation(async () => fixture);
  h.invalidateBootstrapCache.mockReset();
  h.commitMutations.mockReset();
  h.commitMutations.mockImplementation(async (mutations: unknown) => {
    applyToFixture(fixture, mutations as MutationRow[]);
  });
  h.propagate.mockReset();
  h.propagate.mockResolvedValue({ conflicts: [] });
  h.loadAppOverrides.mockReset();
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

describe("写完之后列表要跟着变（可见行，不是缓存开关）", () => {
  it("qcm01_rename_updates_the_visible_row_label", async () => {
    await mount(root!, createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }));
    expect(categoryRow(CUSTOM)?.textContent, "起始行名字不对").toContain("我的项目");

    act(() => { renameButton(CUSTOM)?.click(); });
    await flush();
    const input = document.body.querySelector<HTMLInputElement>(".quick-classification-rename-input");
    expect(input, "改名弹窗没打开").not.toBeNull();
    typeInto(input, "课题");
    await flush();
    const submit = document.body.querySelector<HTMLButtonElement>("button[form='quick-classification-rename-form']");
    await act(async () => { submit?.click(); });
    await flush();

    /* 判据落在 DOM 上：那一行还是同一个 id，名字已经是新的 */
    const row = categoryRow(CUSTOM);
    expect(row, "改名之后那一行不见了（不该换 id）").not.toBeNull();
    expect(row?.textContent, `改名后可见行没跟上：${row?.textContent ?? ""}`).toContain("课题");
    expect(row?.textContent ?? "", "改名后旧名字还在").not.toContain("我的项目");
  });

  it("qcm02_recolor_keeps_the_row_and_rereads", async () => {
    const onChanged = vi.fn();
    await mount(root!, createElement(DataCategoryManageDialog, {
      open: true, onClose: () => undefined, onChanged,
    }));
    const trigger = manageDialog()?.querySelector<HTMLButtonElement>(
      `[data-category="${CUSTOM}"] .at-color-trigger`,
    );
    expect(trigger, "分类行没有色块").not.toBeNull();
    const loadsBefore = h.loadBootstrap.mock.calls.length;
    const changedBefore = onChanged.mock.calls.length;

    act(() => { trigger?.click(); });
    await flush();
    const reset = document.body.querySelector<HTMLButtonElement>(".at-color-popover-actions button");
    await act(async () => { reset?.click(); });
    await flush();

    const colorRow = committedRows(h.commitMutations).find((item) => item.key.startsWith(COLOR_PREFIX));
    expect(colorRow, "改色没有写库").toBeDefined();
    expect(colorRow?.value, "「恢复默认色」必须写 null").toBeNull();
    expect(h.loadBootstrap.mock.calls.length, "改色之后没有重读").toBeGreaterThan(loadsBefore);
    expect(onChanged.mock.calls.length, "改色没有通知页面重取数").toBe(changedBefore + 1);
    /* 改色只改颜色：那一行还在，名字不变 */
    expect(categoryRow(CUSTOM)?.textContent).toContain("我的项目");

    /* 再走一次「选一个新颜色」：重读之后**色块本身**必须变成那个颜色。
       `qcm02` 原来只验了"行还在 + 名字不变"，色块没换等于用户改了白改
       （`buildAppEditCategoryOptions` 取的是 `loadedCategoryColorOverrides`）。 */
    const swatch = () =>
      categoryRow(CUSTOM)?.querySelector<HTMLElement>(".at-color-trigger-swatch")?.style.backgroundColor ?? "";
    const beforeSwatch = swatch();
    /* 「恢复默认色」之后弹层可能还开着（它不负责关闭），点一次是开还是关取决于当前状态 ——
       所以按"输入框在不在"决定要不要点，别赌弹层的开关顺序。 */
    if (!document.body.querySelector(".at-color-text-input")) {
      act(() => { categoryRow(CUSTOM)?.querySelector<HTMLButtonElement>(".at-color-trigger")?.click(); });
      await flush();
    }
    const hexInput = document.body.querySelector<HTMLInputElement>(".at-color-text-input");
    expect(hexInput, "色块弹层里没有 HEX 输入框").not.toBeNull();
    typeInto(hexInput, "#123456");
    await flush();
    expect(swatch(), `色块没跟上重读结果（改前 ${beforeSwatch}）`).toBe("rgb(18, 52, 86)");
  });

  it("qcm03_delete_removes_the_visible_row_and_keeps_the_builtin_ones", async () => {
    const onChanged = vi.fn();
    await mount(root!, createElement(DataCategoryManageDialog, {
      open: true, onClose: () => undefined, onChanged,
    }));
    expect(categoryRow(CUSTOM), "起始列表里没有那条自定义分类").not.toBeNull();
    const changedBefore = onChanged.mock.calls.length;

    await act(async () => { deleteButton(CUSTOM)?.click(); });
    await flush();
    await act(async () => { confirmButton()?.click(); });
    await flush();

    expect(categoryRow(CUSTOM), "删了之后那一行还在（写库没生效 / 没重读）").toBeNull();
    /* 内置分类一个都不许被带走 */
    expect(categoryRow("development"), "删除把内置分类带走了").not.toBeNull();
    expect(categoryRow("design"), "删除把内置分类带走了").not.toBeNull();
    expect(onChanged.mock.calls.length, "删除没有通知页面重取数").toBe(changedBefore + 1);
  });
});

/**
 * [QA 补测] 面板接线（源码级）。
 *
 * `cm01` 只测了 `DataCategoryManageEntry` 自己按 `visible` 开关，而"分类 tab 上才有入口"
 * 这句话真正的判据在**调用点**：`DataAppTrendPanel` 传的是不是 `destinationMode === "category"`。
 * 传错（恒真 / 恒假 / 漏传 `manageableCategories`）时，组件级那四条用例全绿，用户却要么在
 * 应用 tab 上看到「管理分类」，要么双击分类行什么也不发生。整页渲染的夹具太重，这里按
 * 本仓既有的 source test 口径钉住调用点。
 */
describe("面板接线（源码级判据）", () => {
  const panelSource = (): string => {
    /* `import.meta.url` 的字符串字面量形态会被 vite 重写成 dev-server URL，用 dirname 拼 */
    const here = dirname(fileURLToPath(import.meta.url));
    return readFileSync(join(here, "DataAppTrendPanel.tsx"), "utf8");
  };

  it("qcm04_the_entry_visibility_is_bound_to_the_category_tab", () => {
    const source = panelSource();
    expect(source, "「管理分类」入口没有绑到分类 tab 上").toContain(
      '<DataCategoryManageEntry visible={destinationMode === "category"}',
    );
    /* 双击分类行也要走同一个开关（`manageableCategories`），否则双击什么都不会发生 */
    expect(source, "双击分类行的分支没接（manageableCategories）").toContain(
      'manageableCategories: destinationMode === "category"',
    );
    /* 应用 tab 的编辑分支不许被顺手改掉 */
    expect(source).toContain('editable: destinationMode === "app"');
    /* 写完要通知页面重取数（趋势图按旧分类渲染是用户看得见的错） */
    expect(source, "入口没接 onChanged（写完页面不重取数）").toContain("onChanged={onRetry}");
  });
});
