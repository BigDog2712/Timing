(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useAppTrendRowEdit } from "../hooks/useAppTrendRowEdit.ts";
import type { DataDestinationTrendOption } from "../services/dataDestinationState.ts";
import { createTestContainer, flush } from "./dataCategoryManage.test-utils.tsx";

/**
 * 分类 tab 上「双击一行」的判据（[本轮]）。
 *
 * ## 双击在这里是什么意思
 *
 * 应用 tab 的双击 = 打开那个应用的设置；分类 tab 的双击 = 打开「分类管理」。
 * 两件事同一个手势，所以必须钉住"不许串味"：分类 tab 上不许开出应用设置，应用 tab 上
 * 也不许开出分类管理。
 *
 * ## 为什么不给分类模式加"选中集补偿"
 *
 * 应用 tab 之所以要补偿（`useAppTrendRowEdit` 文件头那一大段），是因为它把单击**推迟**了
 * 260ms —— 慢速双击时定时器早就跑完，选中被翻过一次，只能事后还原。分类模式没有推迟：
 * `canEdit` 为假那条分支里单击**立即**生效，一串点击从来没建过 `burstRef`，所以根本没有
 * "翻错了要还原"这件事。加补偿反而是给一条不存在的路径写代码。
 *
 * 代价说清楚：双击分类行会顺带把选中换成这一行的那一类 —— 那是**一次真实单击**的实际行为。
 * 分类选中只决定"画哪几条曲线"，没有守卫、没有提示、也不写库，所以可以接受。
 * 判据因此写成"只发一道选中命令、一次还原都不发"，而不是"选中不变"。
 */
const categoryOption = {
  key: "development",
  displayName: "开发",
  exeName: null,
  iconUrl: null,
  classificationCategory: "development",
  accentColor: "#6B7C93",
  totalDuration: 0,
  percentage: 0,
} as unknown as DataDestinationTrendOption;

let container: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
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

/** 按浏览器真实顺序派发一次双击：click(1) → click(2) → dblclick */
async function doubleClickRow(): Promise<void> {
  const node = container?.querySelector<HTMLElement>("#row") as HTMLElement;
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
  });
  await flush();
}

describe("④ 分类模式的双击：开弹窗，但不做选中集补偿", () => {
  it("cm13_double_clicking_a_category_row_opens_manage_and_never_restores", async () => {
    const selects: string[] = [];
    const restores: (readonly string[])[] = [];
    /* 用持有对象而不是裸 `let`：赋值发生在子组件里，TS 的函数内赋值收窄看不见它 */
    const holder: { state: ReturnType<typeof useAppTrendRowEdit> | null } = { state: null };
    function Harness() {
      holder.state = useAppTrendRowEdit({
        editable: false,
        manageableCategories: true,
        supportsDestinationDetails: false,
        selectedKeys: [],
        onOptionSelect: (key: string) => selects.push(key),
        onRestoreSelection: (keys: readonly string[]) => restores.push(keys),
        onOptionOpenDetails: () => undefined,
      });
      return createElement("button", { id: "row", type: "button", ...holder.state.handlers(categoryOption) }, "开发");
    }
    act(() => root?.render(createElement(Harness)));
    await flush();

    await doubleClickRow();
    expect(holder.state?.categoryManageOpen, "双击分类行没有打开「分类管理」").toBe(true);
    expect(selects, "只有第一下单击发选中命令，双击的第二下不许再发").toEqual(["development"]);
    expect(restores, "分类模式不该走选中集还原补偿").toEqual([]);
    /* 关掉之后不会自动弹回来 */
    act(() => holder.state?.closeCategoryManage());
    expect(holder.state?.categoryManageOpen).toBe(false);
  });

  it("cm14_the_app_tab_double_click_still_opens_the_app_editor", async () => {
    /* 同一条双击在应用 tab 上仍是"打开应用设置"：新分支不许把既有链路顶掉 */
    const appOption = { ...categoryOption, key: "code.exe", exeName: "code.exe" } as unknown as DataDestinationTrendOption;
    const holder: { state: ReturnType<typeof useAppTrendRowEdit> | null } = { state: null };
    function AppHarness() {
      holder.state = useAppTrendRowEdit({
        editable: true,
        supportsDestinationDetails: true,
        selectedKeys: [],
        onOptionSelect: () => undefined,
        onOptionOpenDetails: () => undefined,
      });
      return createElement("button", { id: "row", type: "button", ...holder.state.handlers(appOption) }, "Code");
    }
    act(() => root?.render(createElement(AppHarness)));
    await flush();

    await doubleClickRow();
    expect(holder.state?.editing?.exeName).toBe("code.exe");
    expect(holder.state?.categoryManageOpen, "应用 tab 上不该开分类管理").toBe(false);
  });

  it("cm15_the_web_tab_double_click_opens_neither", async () => {
    /* 网页 tab：既不能改应用，也没有分类可管 —— 双击什么都不该开 */
    const holder: { state: ReturnType<typeof useAppTrendRowEdit> | null } = { state: null };
    function WebHarness() {
      holder.state = useAppTrendRowEdit({
        editable: false,
        supportsDestinationDetails: false,
        selectedKeys: [],
        onOptionSelect: () => undefined,
        onOptionOpenDetails: () => undefined,
      });
      return createElement("button", { id: "row", type: "button", ...holder.state.handlers(categoryOption) }, "x.com");
    }
    act(() => root?.render(createElement(WebHarness)));
    await flush();

    await doubleClickRow();
    expect(holder.state?.editing).toBeNull();
    expect(holder.state?.categoryManageOpen).toBe(false);
  });
});
