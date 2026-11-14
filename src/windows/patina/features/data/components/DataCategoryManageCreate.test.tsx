(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 新建分类的三条判据。
 *
 * ## ① 用户没选色 → 不许写颜色覆盖（双向断言）
 *
 * 色块上那个灰只是**预览**。用户什么都不动就提交，写出去的必须是「定义 + 标签」两条，
 * 一条 `__category_color_override::` 都不能有 —— 否则等于把"用户从没选过的颜色"记成他的
 * 选择（上一轮清掉的 D-3 僵尸记录同类），而且所有新建分类都会长成同一个灰。
 * 反方向同样要钉：**动过**色块就必须写那条覆盖，否则"选了色却没生效"。
 *
 * 变异自证：把 `DataAppEditCategoryManager` 的 `useState<string | null>(null)` 改回
 * `useState<string>("#8A8F99")`（即 `onCreate` 又收到具体色值），cm06 立刻红：
 * `新建写了：__custom_category::custom:…=… | __category_label_override::…=读论文 |
 * __category_color_override::custom:…=#8A8F99`（下面第二条 expect 的 not.toContain 打红）。
 *
 * ## ② 写完必须重读：新建的分类要**当场出现在列表里**
 *
 * 只断言"mutation 被调用过"是假绿 —— 上一轮 `DataAppEditDialog` 就栽在"只写库不重读"：
 * 保存后列表停在旧值，用户以为没存上。所以这里搭一个**假库**（提交写进 fixture，
 * 下一次读就把新分类带回来），断言的是**列表里出现了那一行**、名字与用量都对。
 * 变异自证：把 `useAppEditCategoryAdmin.createCategory` 里的 `await refreshBootstrap()`
 * 注释掉，cm09 立刻红（`新建的 custom:category_… 没有出现在列表里（写了库但没重读）`）。
 *
 * ## ③ 页面要收到"该重取数了"的信号
 *
 * 弹窗里的列表重读只解决"弹窗自己看见"；分类 tab 上的趋势图还按旧分类着色/排行。所以写成功
 * 之后必须给页面发一次 `onChanged`（`useCategoryAdminSession` 四个写操作各包一层）。
 * 口径是**无条件发**：被拒（重名/空名）与写失败也会发一次，代价是页面多取一次数，好处是
 * 绝不会有"写了库但页面没刷新"的漏发（那一种才是用户看得见的错）。
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

import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";
import {
  bootstrapFixture,
  categoryRow,
  committedRows,
  createTestContainer,
  flush,
  manageDialog,
  mount,
  typedValue,
  typeInto,
} from "./dataCategoryManage.test-utils.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/** 新建行里的名字输入框 */
const nameInput = () => manageDialog()?.querySelector<HTMLInputElement>(".data-category-create-input") ?? null;
/** 新建行里的「新建分类」键（`qp-link-btn`；色块不是 button） */
function createButton(): HTMLButtonElement | null {
  return Array.from(manageDialog()?.querySelectorAll<HTMLButtonElement>(".data-category-create-row button") ?? [])
    .find((button) => button.className.includes("qp-link-btn")) ?? null;
}
/** 新建行里的色块（`QuietColorField` 的触发器） */
const createSwatch = () => manageDialog()?.querySelector<HTMLButtonElement>(".data-category-create-row .qp-color-trigger") ?? null;
/** 色块弹层里的 HEX 输入（弹层 portal 到 body） */
const hexInput = () => document.body.querySelector<HTMLInputElement>(".qp-color-popover input.qp-color-text-input");
/** 「不选色则按调色板自动取色」那行小字（只有未选色时才在） */
const createHint = () => manageDialog()?.querySelector<HTMLElement>(".data-category-create-hint");
const dialogElement = createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined });

/* mutation 键前缀（与 `categoryDefinitionMutations` / `classificationStore` 一致） */
const DEFINITION_PREFIX = "__custom_category::";
const LABEL_PREFIX = "__category_label_override::";
const COLOR_PREFIX = "__category_color_override::";

type Fixture = ReturnType<typeof bootstrapFixture>;
type MutationRow = { key: string; value: string | null };

/** 假库：把一次提交按前缀落进 fixture，下一次 `loadClassificationBootstrap` 就带回来 */
function applyToFixture(fixture: Fixture, mutations: MutationRow[]): void {
  const persistedIds = fixture.loadedPersistedCategoryIds as string[];
  const labels = fixture.loadedCategoryLabelOverrides as Record<string, string | null>;
  const colors = fixture.loadedCategoryColorOverrides as Record<string, string | null>;
  for (const { key, value } of mutations) {
    if (key.startsWith(DEFINITION_PREFIX)) {
      const id = key.slice(DEFINITION_PREFIX.length);
      if (!persistedIds.includes(id)) persistedIds.push(id);
    } else if (key.startsWith(LABEL_PREFIX)) {
      labels[key.slice(LABEL_PREFIX.length)] = value;
    } else if (key.startsWith(COLOR_PREFIX)) {
      colors[key.slice(COLOR_PREFIX.length)] = value;
    }
  }
}

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockResolvedValue(bootstrapFixture());
  h.invalidateBootstrapCache.mockReset();
  h.commitMutations.mockReset();
  h.commitMutations.mockResolvedValue(undefined);
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

describe("② 新建：名字必填，颜色只在用户选过时才写", () => {
  it("cm05_the_create_row_is_disabled_until_a_name_is_typed", async () => {
    /* 空名不许提交（提交了也只会被归一成空串丢掉，等于点了没反应） */
    await mount(root!, dialogElement);
    expect(createButton()?.disabled, "空名时新建键应当是灭的").toBe(true);
    typeInto(nameInput(), "读论文");
    await flush();
    expect(createButton()?.disabled).toBe(false);
  });

  it("cm06_create_without_touching_the_swatch_writes_no_color_override", async () => {
    await mount(root!, dialogElement);
    /* 未选色：小字说明"这只是预览色，不选就按调色板取色" */
    expect(createHint()?.textContent ?? "", "未选色时没有那行说明").toContain("调色板");
    typeInto(nameInput(), "读论文");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();

    expect(h.commitMutations, "新建没有写库").toHaveBeenCalledTimes(1);
    const written = typedValue(h.commitMutations);
    /* 定义（`__custom_category::` = "这个 id 存在"）+ 标签，两者在**同一次**提交里 */
    expect(written, `新建写了：${written}`).toContain("__custom_category::custom:");
    expect(written).toContain("__category_label_override::custom:");
    expect(written).toContain("读论文");
    /* 关键：用户没碰过色块 → 一条颜色覆盖都不许写 */
    expect(written, `用户没选色却写了颜色覆盖：${written}`).not.toContain(COLOR_PREFIX);
    expect(committedRows(h.commitMutations), `提交的行数不对：${written}`).toHaveLength(2);
    /* 写完必须作废缓存并重读（分类候选清单来自 bootstrap） */
    expect(h.invalidateBootstrapCache).toHaveBeenCalled();
    expect(h.loadBootstrap).toHaveBeenCalledTimes(2);
  });

  it("cm06b_picking_a_color_writes_that_override_in_the_same_commit", async () => {
    await mount(root!, dialogElement);
    typeInto(nameInput(), "读论文");
    await flush();
    act(() => { createSwatch()?.click(); });
    await flush();
    typeInto(hexInput(), "#12AB34");
    await flush();
    /* 选过之后"这只是预览"的说明就该撤掉，否则它变成一句假话 */
    expect(createHint(), "选过色之后那行小字应当消失").toBeNull();
    await act(async () => { createButton()?.click(); });
    await flush();

    expect(h.commitMutations).toHaveBeenCalledTimes(1);
    const written = typedValue(h.commitMutations);
    expect(written, `选了色却没写覆盖：${written}`).toContain(COLOR_PREFIX);
    expect(written, `写的不是用户选的那个色：${written}`).toContain("#12AB34");
    expect(committedRows(h.commitMutations), `提交的行数不对：${written}`).toHaveLength(3);
  });

  it("cm07_a_duplicate_name_is_refused_but_says_so", async () => {
    await mount(root!, dialogElement);
    typeInto(nameInput(), "我的项目");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();
    /* 重名不提交，但必须说一句 —— 静默返回会被当成"点了没反应" */
    expect(h.commitMutations).not.toHaveBeenCalled();
    expect(manageDialog()?.textContent).toContain("已经有同名分类了");
  });

  it("cm08_a_blank_name_is_normalized_away_without_writing", async () => {
    /* 只有空格的名字：归一后为空 → 不提交、不报错、不写库 */
    await mount(root!, dialogElement);
    typeInto(nameInput(), "   ");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();
    expect(h.commitMutations).not.toHaveBeenCalled();
  });

  it("cm09_a_created_category_appears_in_the_list_right_away", async () => {
    /* 假库：提交写进 fixture，下一次读就带回来 —— "重读"这一步因此成了断言的前提 */
    const fixture = bootstrapFixture();
    h.loadBootstrap.mockImplementation(async () => fixture);
    h.commitMutations.mockImplementation(async (mutations: unknown) => {
      applyToFixture(fixture, mutations as MutationRow[]);
    });

    await mount(root!, dialogElement);
    expect(categoryRow("custom:1720000000000")?.textContent, "起始列表里应当有那条自定义分类")
      .toContain("我的项目");

    typeInto(nameInput(), "读论文");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();

    const created = committedRows(h.commitMutations).find((row) => row.key.startsWith(DEFINITION_PREFIX));
    expect(created, `新建没有写定义：${typedValue(h.commitMutations)}`).toBeDefined();
    const createdId = created!.key.slice(DEFINITION_PREFIX.length);
    /* 不是断言"mutation 被调用过"，而是断言**列表里出现了这一行** */
    const row = categoryRow(createdId);
    expect(row, `新建的 ${createdId} 没有出现在列表里（写了库但没重读）`).not.toBeNull();
    expect(row?.textContent, "新建的那一行名字不对").toContain("读论文");
    /* 用量读数也要当场跟上：新建的分类还没有任何应用指着它 */
    expect(row?.textContent, "新建的那一行用量读数不对").toContain("0 个在用");
  });

  it("cm09b_a_successful_create_tells_the_page_to_refetch", async () => {
    /* 分类 tab 的趋势图按旧分类着色/排行，重读弹窗自己的列表管不到它 —— 必须发 onChanged */
    const onChanged = vi.fn();
    await mount(root!, createElement(DataCategoryManageDialog, {
      open: true,
      onClose: () => undefined,
      onChanged,
    }));

    /* 先来一次会被拒的提交（重名）：不许写库，也不许因此多算一次"成功"的通知 */
    typeInto(nameInput(), "我的项目");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();
    expect(h.commitMutations, "重名不该写库").not.toHaveBeenCalled();
    const afterRefused = onChanged.mock.calls.length;

    typeInto(nameInput(), "读论文");
    await flush();
    await act(async () => { createButton()?.click(); });
    await flush();
    expect(h.commitMutations, "新建没有写库").toHaveBeenCalledTimes(1);
    expect(onChanged.mock.calls.length, "写成功了却没有通知页面重取数（趋势图仍按旧分类渲染）")
      .toBe(afterRefused + 1);
  });
});
