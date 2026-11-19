import { act } from "react";
import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DataDestinationTrendOption } from "../services/dataDestinationState.ts";
import { useAppTrendRowEdit } from "./useAppTrendRowEdit.ts";

/**
 * 双击的落点（[0.12.4]）：从「应用设置 / 分类弹窗」改成**标签弹窗**。
 *
 * 判据只钉一件事 —— 双击到底交给了谁：
 *   · 宿主给了 `onEditOption`（应用趋势的真实形态）→ 只调它，内建弹窗**不许**打开
 *     （否则页面上会同时出现标签弹层和分类弹窗）；
 *   · 没给（判据 / 无标签入口的宿主）→ 退回内建 `editing`，旧行为不破。
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const OPTION_A = {
  key: "a.exe",
  identityKeys: ["a.exe"],
  exeName: "a.exe",
  classificationCategory: "other",
  displayName: "Alpha",
  secondaryText: "a.exe",
  iconUrl: null,
  totalDuration: 0,
  percentage: 0,
  averageDuration: 0,
  activeDayCount: 0,
} as unknown as DataDestinationTrendOption;

let container: HTMLDivElement;
let root: Root;

interface HarnessProps {
  onEditOption?: (option: DataDestinationTrendOption) => void;
}

function Harness({ onEditOption }: HarnessProps) {
  const hook = useAppTrendRowEdit({
    editable: true,
    supportsDestinationDetails: true,
    selectedKeys: [],
    onOptionSelect: () => undefined,
    onOptionOpenDetails: () => undefined,
    onEditOption,
  });
  return createElement("div", null,
    createElement("button", { id: "row-a", type: "button", ...hook.handlers(OPTION_A) }, "Alpha"),
    createElement("span", { id: "editing" }, hook.editing?.exeName ?? ""));
}

function mount(props: HarnessProps) {
  act(() => root.render(createElement(Harness, props)));
}

function doubleClick() {
  const row = container.querySelector<HTMLElement>("#row-a");
  act(() => {
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
    row?.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
    row?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, detail: 2 }));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

describe("应用趋势双击的落点", () => {
  it("te01_hands_the_row_to_the_host_editor_instead_of_the_builtin_dialog", () => {
    const onEditOption = vi.fn();
    mount({ onEditOption });
    doubleClick();
    expect(onEditOption).toHaveBeenCalledTimes(1);
    expect(onEditOption.mock.calls[0][0].exeName).toBe("a.exe");
    expect(container.querySelector("#editing")?.textContent, "内建弹窗不许同时打开").toBe("");
  });

  it("te02_keeps_the_builtin_target_when_the_host_has_no_editor", () => {
    mount({});
    doubleClick();
    expect(container.querySelector("#editing")?.textContent).toBe("a.exe");
  });
});
