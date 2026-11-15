(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { StrictMode, act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [StrictMode 双调用] 「管理分类」弹窗**必须**走完加载。
 *
 * ## 为什么这条用例必须存在（这次真的漏网了）
 *
 * 生产构建里 `StrictMode` 不双调用 effect，jsdom 测试默认也不用 `StrictMode`
 * —— 所以四个 `DataCategoryManage*.test.tsx` 全绿、`npm test` 全绿、CI 全绿，
 * 而 `npm run dev` 里用户点开「管理分类」永远停在"加载中"。
 *
 * 这条用例把消费方（`DataCategoryManageDialog`）整棵包进 `<StrictMode>`，
 * 断言的是用户能看见的东西：加载结束后不再是"加载中"，分类行真的出现。
 *
 * **别把它当"多余的严格模式测试"删掉。** 它钉住的是
 * `useCategoryAdminSession` 里那个 effect 的写法：`loadedRef` 守卫 + `active`
 * 作废这两件事同时存在时，第二次挂载会被守卫挡掉（不再发起加载、也不再持有
 * cleanup），唯一那次加载的 `active` 已被第一次 cleanup 置 false，
 * 于是 `setLoading(false)` 被跳过 → 永久 loading。详见那个 hook 里的注释。
 */
const h = vi.hoisted(() => ({
  loadBootstrap: vi.fn(),
  invalidateBootstrapCache: vi.fn(),
  saveAppOverride: vi.fn(async (): Promise<void> => undefined),
  saveWebDomainOverride: vi.fn(async (): Promise<void> => undefined),
}));

vi.mock("../../classification/services/classificationService.ts", () => ({
  ClassificationService: {
    loadClassificationBootstrap: h.loadBootstrap,
    invalidateBootstrapCache: h.invalidateBootstrapCache,
    saveAppOverride: h.saveAppOverride,
    saveWebDomainOverride: h.saveWebDomainOverride,
  },
}));

import DataCategoryManageDialog from "./DataCategoryManageDialog.tsx";
import { LocaleProvider } from "../../../shared/i18n/LocaleContext.tsx";
import {
  CUSTOM,
  bootstrapFixture,
  categoryRow,
  createTestContainer,
  flush,
  manageDialog,
} from "./dataCategoryManage.test-utils.tsx";

let container: HTMLDivElement | null = null;
let root: Root | null = null;

/**
 * "加载中"那一行：`<p className="at-app-edit-hint" role="status">`。
 * 同名的 `.at-app-edit-hint` 还有一条**不带** `role="status"` 的说明文字（加载完才出现），
 * 所以用 `[role='status']` 才能唯一指认加载态 —— 出错那条挂的是 `.at-app-edit-issue`。
 */
const loadingLine = () =>
  manageDialog()?.querySelector<HTMLElement>(".at-app-edit-hint[role='status']") ?? null;

beforeEach(() => {
  h.loadBootstrap.mockReset();
  h.loadBootstrap.mockImplementation(async () => bootstrapFixture());
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

describe("StrictMode 双调用下「管理分类」必须加载完", () => {
  it("qcm05_strict_mode_remount_still_finishes_loading", async () => {
    /* **`StrictMode` 必须挂在渲染树的根**：挂在中间（例如 `LocaleProvider` 之内）React
       根本不做 effect 双调用，本用例会假绿 —— 这一条踩过一次，别再改回去。
       这也正是 `shell/main.tsx` 的真实结构：`<StrictMode><App/></StrictMode>`，
       `LocaleProvider` 在 `App` 里面。 */
    act(() => root!.render(createElement(StrictMode, null, createElement(LocaleProvider, {
      locale: "zh-CN",
      children: createElement(DataCategoryManageDialog, { open: true, onClose: () => undefined }),
    }))));
    await flush();

    expect(h.loadBootstrap.mock.calls.length, "一次 bootstrap 都没读").toBeGreaterThan(0);
    const stuck = loadingLine();
    expect(
      stuck,
      `StrictMode 下永久停在"加载中"（loading 没有回落）：${stuck?.textContent ?? ""}`,
    ).toBeNull();
    expect(categoryRow(CUSTOM), "加载结束后自定义分类那一行没出现").not.toBeNull();
    expect(categoryRow("development"), "加载结束后内置分类那一行没出现").not.toBeNull();
  });
});
