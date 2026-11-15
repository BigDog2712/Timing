(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [StrictMode 双调用] 「应用设置」弹窗**必须**走完加载。
 *
 * ## 为什么这条用例必须存在（和「管理分类」同一天漏网的同一款缺陷）
 *
 * `shell/main.tsx` 挂着 `<StrictMode>`，dev 里 effect 会被 setup → cleanup → setup 跑两遍。
 * `useAppEditDialog` 里曾经的写法是「`if (loadedRef.current) return; loadedRef.current = true;`
 * + `active` 作废」，两者放在一起就是**永久停在"加载中"**：
 *
 *   · setup1 置 `loadedRef = true` 并发起**唯一一次**异步加载，`active1 = true`；
 *   · cleanup1 把 `active1` 置 false；
 *   · setup2 被 `loadedRef` 挡掉 —— 既不发起加载，也不再持有 cleanup；
 *   · 那次加载 resolve 时 `active1` 已是 false，`setLoading(false)` 被跳过。
 *
 * 生产构建不双调用、jsdom 测试默认不用 `StrictMode` —— 所以 `DataAppEditDialog.test.tsx`
 * 六条全绿、`npm test` 全绿、CI 全绿，而 `npm run dev` 里双击应用趋势的一行永远停在
 * 「加载中...」，`canSave` / `dirty` 恒 false，用户连"没得改"都看不出来。
 *
 * 判据只有两条，都是用户能看见的东西：bootstrap 真的读过一次；加载态那一行消失。
 *
 * **别把它当"多余的严格模式测试"删掉。** 它的变异靶点是把 `loadedRef` 守卫加回
 * `useAppEditDialog.ts`（配套的源码护栏见 `hooks/appEditLoadingGuard.source.test.ts`）。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
  listItems: vi.fn(),
  loadSingleBinding: vi.fn(async () => null as number | null),
  clearBinding: vi.fn(async (): Promise<void> => undefined),
  commitMutations: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: {
    loadClassificationBootstrap: h.loadBootstrap,
    invalidateBootstrapCache: h.invalidateBootstrapCache,
    saveAppOverride: h.saveAppOverride,
    saveWebDomainOverride: h.saveWebDomainOverride,
  },
}));
/* [0.13 fix · P0-3] 弹窗现在还会读/清 1:1 那份绑定（`__app_item_binding::<exe>`）：
   两个入口都得给桩，否则模块里那两个导出是 undefined —— 加载分支会抛，整屏停在"加载失败"
   （这正是本文件先前三条用例一起红的原因）。默认"没有 1:1 绑定"，各自用例再按需覆盖。 */
vi.mock("../../dashboard/services/appItemBinding.ts", () => ({
  listAppItemBindingOptions: h.listItems,
  loadAppItemBindingFor: h.loadSingleBinding,
  clearAppItemBinding: h.clearBinding,
}));
vi.mock("../../../platform/persistence/classificationSettingsGateway.ts", () => ({
  commitClassificationSettingMutations: h.commitMutations,
}));

import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
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

/**
 * "加载中"那一行：`<p className="at-app-edit-hint" role="status">`。
 * 同名的 `.at-app-edit-hint` 还有一条**不带** `role="status"` 的说明文字（加载完才出现），
 * 所以用 `[role='status']` 才能唯一指认加载态 —— 出错那条挂的是 `.at-app-edit-issue`。
 */
const loadingLine = () =>
  document.body.querySelector<HTMLElement>(".at-app-edit-hint[role='status']") ?? null;

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockImplementation(async () => bootstrapFixture());
  h.invalidateBootstrapCache.mockReset();
  h.saveAppOverride.mockReset();
  h.saveAppOverride.mockImplementation(async () => undefined);
  h.listItems.mockReset();
  h.loadSingleBinding.mockReset();
  h.loadSingleBinding.mockImplementation(async () => null);
  h.clearBinding.mockReset();
  h.clearBinding.mockImplementation(async () => undefined);
  h.listItems.mockImplementation(async () => [{ id: 7, name: "写代码", color: "" }]);
  h.commitMutations.mockReset();
  h.commitMutations.mockImplementation(async () => undefined);
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

describe("StrictMode 双调用下「应用设置」弹窗必须加载完", () => {
  it("probe_app_edit_dialog_strict_mode_finishes_loading", async () => {
    /* **`StrictMode` 必须挂在渲染树的根**：挂在中间（例如 `LocaleProvider` 之内）React
       根本不做 effect 双调用，本用例会假绿 —— 这一条踩过一次，别再改回去。
       这也正是 `shell/main.tsx` 的真实结构：`<StrictMode><App/></StrictMode>`，
       `LocaleProvider` 在 `App` 里面。 */
    await act(async () => {
      root!.render(createElement(StrictMode, null, createElement(LocaleProvider, {
        locale: "zh-CN",
        children: createElement(DataAppEditDialog, { app: APP, onClose: () => undefined }),
      })));
    });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });

    const stuck = loadingLine();
    expect(h.loadBootstrap.mock.calls.length, "一次 bootstrap 都没读").toBeGreaterThan(0);
    expect(stuck?.textContent ?? null, "StrictMode 下永久停在加载中").toBeNull();
  });

  it("probe_app_edit_dialog_strict_mode_reaches_a_saveable_draft", async () => {
    /* 加载完只是第一步：`loading` 恒 true 时 `canSave` / `dirty` 也是恒 false，
       用户即使看得见内容也"什么都改不了"（这条把那个后果一并钉住）。 */
    await act(async () => {
      root!.render(createElement(StrictMode, null, createElement(LocaleProvider, {
        locale: "zh-CN",
        children: createElement(DataAppEditDialog, { app: APP, onClose: () => undefined }),
      })));
    });
    for (let i = 0; i < 5; i += 1) await act(async () => { await Promise.resolve(); });

    const checkbox = document.body.querySelector<HTMLInputElement>(
      ".at-app-edit-option[data-category='office'] input[type='checkbox']",
    );
    expect(checkbox, "加载完却没有分类候选行（说明内容区还停在加载态）").not.toBeNull();
    await act(async () => { checkbox?.click(); });
    for (let i = 0; i < 3; i += 1) await act(async () => { await Promise.resolve(); });
    const save = Array.from(document.body.querySelectorAll<HTMLButtonElement>("button"))
      .find((button) => button.textContent === "保存");
    expect(save?.disabled, "改了勾选保存键仍然是灭的（dirty/canSave 恒 false）").toBe(false);
  });
});
