(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppTrendRowEdit } from "./useAppTrendRowEdit.ts";
import type { DataDestinationTrendOption } from "../services/dataDestinationState.ts";

/**
 * 「单击选中 / 双击编辑」共存的判据（[本轮]）。
 *
 * 用户口径：双击应用趋势里的一行要能打开「应用设置」，但**不许**顺手把左侧已选的
 * 应用集合换掉。浏览器的序列是 `click(detail=1) → click(detail=2) → dblclick`，
 * 所以判据必须打在**时序**上：
 *   ① 双击后 `onOptionSelect` 一次都没被调用（不是"调了两次又还原"）；
 *   ② 双击确实开了弹窗（目标 = 那一行的 exe）；
 *   ③ 单独一次 click 过了短窗之后照常选中（推迟 ≠ 吞掉）；
 *   ④ 双击**行首图标**仍然走既有的「打开详情」链路，且不开编辑弹窗；
 *   ⑤ 非应用模式（分类 / 网页）单击立即生效，不引入延迟。
 */
const option = {
  key: "code.exe",
  displayName: "Code",
  exeName: "code.exe",
  iconUrl: null,
  classificationCategory: "development",
  totalDuration: 0,
  percentage: 0,
} as unknown as DataDestinationTrendOption;

const anonymousOption = {
  ...option,
  key: "activity:anonymous",
  displayName: "未识别",
} as unknown as DataDestinationTrendOption;

const DOUBLE_CLICK_WINDOW_MS = 260;

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: ReturnType<typeof useAppTrendRowEdit> | null = null;

interface HarnessProps {
  editable: boolean;
  onOptionSelect: (key: string, multi: boolean) => void;
  onOptionOpenDetails: (target: DataDestinationTrendOption) => void;
  row?: DataDestinationTrendOption;
  /** 左侧已选（补偿要还原到它；这些用例里只有"空集"这一种） */
  selectedKeys?: readonly string[];
}

function Harness({
  editable,
  onOptionSelect,
  onOptionOpenDetails,
  row = option,
  selectedKeys = [],
}: HarnessProps) {
  latest = useAppTrendRowEdit({
    editable,
    supportsDestinationDetails: true,
    selectedKeys,
    onOptionSelect,
    onOptionOpenDetails,
  });
  return createElement("div", null,
    createElement("button", { id: "row", type: "button", ...latest.handlers(row) },
      createElement("span", { id: "icon", "data-destination-detail-trigger": "" }),
      createElement("span", { id: "text" }, "Code")),
    createElement("span", { id: "editing" }, latest.editing?.exeName ?? ""));
}

async function mount(props: HarnessProps) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root?.render(createElement(Harness, props)); });
}

async function wait(ms: number) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

/** 按浏览器真实顺序派发一次双击：click(1) → click(2) → dblclick */
async function doubleClick(target: "row" | "icon" = "row") {
  const node = container?.querySelector<HTMLElement>(`#${target}`) as HTMLElement;
  await act(async () => {
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    node.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    node.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
  });
}

const editingName = () => container?.querySelector("#editing")?.textContent ?? "";

beforeEach(() => {
  latest = null;
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("useAppTrendRowEdit · 双击与单击共存", () => {
  it("re01_a_double_click_opens_the_editor_without_touching_the_selection", async () => {
    const onOptionSelect = vi.fn();
    const onOptionOpenDetails = vi.fn();
    await mount({ editable: true, onOptionSelect, onOptionOpenDetails });

    await doubleClick("row");
    /* ① 选中一次都没发生 —— 这是"双击不许换掉左侧已选集合"的硬判据 */
    expect(onOptionSelect).not.toHaveBeenCalled();
    /* ② 弹窗开在这一行上 */
    expect(editingName()).toBe("code.exe");
    expect(onOptionOpenDetails).not.toHaveBeenCalled();

    /* 挂起的单击定时器必须被取消：再等过一个窗口也不许补一次选中 */
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);
    expect(onOptionSelect).not.toHaveBeenCalled();
  });

  it("re02_a_single_click_still_selects_after_the_short_window", async () => {
    const onOptionSelect = vi.fn();
    await mount({ editable: true, onOptionSelect, onOptionOpenDetails: vi.fn() });

    await act(async () => {
      (container?.querySelector("#text") as HTMLElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    /* 推迟不等于吞掉：窗口内还没生效 */
    expect(onOptionSelect).not.toHaveBeenCalled();
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);
    expect(onOptionSelect).toHaveBeenCalledTimes(1);
    expect(onOptionSelect).toHaveBeenCalledWith("code.exe", false);
  });

  it("re03_double_clicking_the_row_icon_still_opens_the_existing_detail", async () => {
    const onOptionOpenDetails = vi.fn();
    await mount({ editable: true, onOptionSelect: vi.fn(), onOptionOpenDetails });

    await doubleClick("icon");
    expect(onOptionOpenDetails).toHaveBeenCalledTimes(1);
    /* 行首图标是另一条既有链路：它不该抢编辑弹窗 */
    expect(editingName()).toBe("");
  });

  it("re04_outside_the_app_mode_a_single_click_is_immediate", async () => {
    const onOptionSelect = vi.fn();
    await mount({ editable: false, onOptionSelect, onOptionOpenDetails: vi.fn() });

    await act(async () => {
      (container?.querySelector("#text") as HTMLElement)
        .dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    });
    /* 分类 / 网页模式没有"第二语义"，不给它们引入几十毫秒的延迟 */
    expect(onOptionSelect).toHaveBeenCalledTimes(1);
  });

  it("re05_an_anonymous_row_never_opens_the_editor", async () => {
    await mount({
      editable: true,
      onOptionSelect: vi.fn(),
      onOptionOpenDetails: vi.fn(),
      row: anonymousOption,
    });
    await doubleClick("row");
    expect(editingName()).toBe("");
  });

  it("re06_the_hook_only_owns_click_and_double_click", async () => {
    /* 行的 mousedown（详情意图）与 contextmenu（快捷分类）仍归面板自己挂：
       这里返回多余的键会把那两条既有链路的处理器顶掉。 */
    await mount({ editable: true, onOptionSelect: vi.fn(), onOptionOpenDetails: vi.fn() });
    expect(Object.keys(latest?.handlers(option) ?? {}).sort()).toEqual(["onClick", "onDoubleClick"]);
  });
});
