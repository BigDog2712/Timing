(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useAppTrendRowEdit } from "./useAppTrendRowEdit.ts";
import {
  replaceDataDestinationSelection,
  toggleDataDestinationSelection,
  type DataDestinationTrendOption,
} from "../services/dataDestinationState.ts";

/**
 * 「单击选中 / 双击编辑」共存 —— **交互边界判据**（QA 复核后重写）。
 *
 * 覆盖真实高频操作：
 *   ① 连点**两行**（间隔 < 窗口）→ 第一行的选中会不会被静默吞掉（D-1）；
 *   ② 双击 A 之后立刻双击 B → 弹窗目标跟着换、A 那次挂起的选中彻底作废；
 *   ③ Ctrl + 双击 → 已有多选集不许被清掉；
 *   ④ 卸载时挂起的定时器要清掉（否则回调打在已卸的父组件上）；
 *   ⑤ **超过推迟窗口的慢速双击**（300ms / 700ms）→ 选中态必须与双击前一致（D-2），
 *      并且连续双击同一行仍然幂等。
 *
 * 选择集模型用**生产代码的两个动词**（`replaceDataDestinationSelection` /
 * `toggleDataDestinationSelection`），并和 `Data.tsx` 一样从**闭包**里读当前集合
 * （同一 tick 内多次调用会互相覆盖）。于是"只剩一项时拒绝取消"的 last-item 守卫也在场 ——
 * 慢速双击的补偿方案必须在守卫存在时自证，否则只是把缺陷挪了个位置。
 */
const DOUBLE_CLICK_WINDOW_MS = 260;

function makeOption(key: string, exeName: string, displayName: string): DataDestinationTrendOption {
  return {
    key,
    displayName,
    exeName,
    iconUrl: null,
    classificationCategory: "development",
    totalDuration: 0,
    percentage: 0,
    selected: false,
    color: "#315F9F",
    accentColor: "#315F9F",
  } as unknown as DataDestinationTrendOption;
}

const OPTION_A = makeOption("a.exe", "a.exe", "Alpha");
const OPTION_B = makeOption("b.exe", "b.exe", "Beta");

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let editingExe = "";
/** 断言用：最近一次渲染出来的选中集（父组件口径，同 `Data.tsx`） */
let selection: string[] = [];

interface HarnessProps {
  editable: boolean;
  initialSelection: readonly string[];
  onSelect: (key: string, multi: boolean) => void;
  onOptionOpenDetails: (option: DataDestinationTrendOption) => void;
}

/** 两行同屏：两行共用**同一个** hook 实例，这才是"跨行连点"的真实形态 */
function Harness({ editable, initialSelection, onSelect, onOptionOpenDetails }: HarnessProps) {
  const [keys, setKeys] = useState<string[]>([...initialSelection]);
  selection = keys;
  const handleSelect = (key: string, multi: boolean) => {
    onSelect(key, multi);
    const next = multi
      ? toggleDataDestinationSelection(keys, key)
      : replaceDataDestinationSelection(key);
    setKeys(next.keys);
  };
  const hook = useAppTrendRowEdit({
    editable,
    supportsDestinationDetails: true,
    selectedKeys: keys,
    onOptionSelect: handleSelect,
    onOptionOpenDetails,
  });
  editingExe = hook.editing?.exeName ?? "";
  return createElement("div", null,
    createElement("button", { id: "row-a", type: "button", ...hook.handlers(OPTION_A) },
      createElement("span", { id: "a-text" }, "Alpha")),
    createElement("button", { id: "row-b", type: "button", ...hook.handlers(OPTION_B) },
      createElement("span", { id: "b-text" }, "Beta")),
    createElement("span", { id: "editing" }, editingExe));
}

async function mount(options: { editable?: boolean; initialSelection?: string[] } = {}) {
  const onSelect = vi.fn();
  const onOptionOpenDetails = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness, {
      editable: options.editable ?? true,
      initialSelection: options.initialSelection ?? [],
      onSelect,
      onOptionOpenDetails,
    }));
  });
  return { onSelect, onOptionOpenDetails };
}

async function wait(ms: number) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function click(id: string, detail: number, ctrlKey = false) {
  act(() => {
    container?.querySelector<HTMLElement>(`#${id}`)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail, ctrlKey }),
    );
  });
}

function fireDoubleClick(id: string) {
  act(() => {
    container?.querySelector<HTMLElement>(`#${id}`)?.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
    );
  });
}

/** 浏览器真实顺序：click(1) → click(2) → dblclick */
function doubleClick(id: string) {
  click(id, 1);
  click(id, 2);
  fireDoubleClick(id);
}

const editingName = () => container?.querySelector("#editing")?.textContent ?? "";

beforeEach(() => {
  editingExe = "";
  selection = [];
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("双击 / 单击 · 交互边界", () => {
  it("ri01_a_double_click_leaves_the_selection_set_byte_identical", async () => {
    const { onSelect } = await mount({ initialSelection: ["already-selected.exe"] });

    doubleClick("row-a");
    expect(onSelect, "窗口内双击一次都不许回调（不是「调完再还原」）").not.toHaveBeenCalled();
    expect(selection).toEqual(["already-selected.exe"]);
    expect(editingName()).toBe("a.exe");

    /* 窗口过去之后也不许补一次（第一下 click 的定时器必须已被取消） */
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);
    expect(onSelect).not.toHaveBeenCalled();
    expect(selection).toEqual(["already-selected.exe"]);
  });

  it("ri02_rapid_ctrl_clicks_on_two_different_rows_keep_both_selected", async () => {
    /* Ctrl+点 A 追加 → 160ms 后 Ctrl+点 B 也追加。修之前 A 的定时器被 B 的点击**直接
       cancel**，第一下点击被静默吞掉（D-1）；现在跨行先 flush 再挂新的。
       注：不带 Ctrl 的连点是"替换"语义，两个都留着只能靠 multi，见 ri03。 */
    const { onSelect } = await mount();

    click("row-a", 1, true);
    await wait(160);
    click("row-b", 1, true);
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect([...selection].sort()).toEqual(["a.exe", "b.exe"]);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("ri03_two_rapid_plain_clicks_honour_both_and_end_with_the_second", async () => {
    /* 不带 Ctrl 的连点 = 两次"替换"：A 的选中必须真的发生（不许被静默 cancel），
       最终集合是 B（替换语义，不是缺陷）。修之前 A 一次都不发。 */
    const { onSelect } = await mount();

    click("row-a", 1);
    await wait(160);
    click("row-b", 1);
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect(onSelect, "两下点击都要被兑现").toHaveBeenCalledTimes(2);
    expect(onSelect).toHaveBeenNthCalledWith(1, "a.exe", false);
    expect(onSelect).toHaveBeenNthCalledWith(2, "b.exe", false);
    expect(selection, "替换语义：最后停在 B").toEqual(["b.exe"]);
  });

  it("ri04_double_clicking_another_row_retargets_the_editor_and_drops_the_first_pending", async () => {
    const { onSelect } = await mount();

    doubleClick("row-a");
    expect(editingName()).toBe("a.exe");
    doubleClick("row-b");
    expect(editingName(), "弹窗跟着换目标（不是「A 的弹窗还开着」）").toBe("b.exe");

    await wait(DOUBLE_CLICK_WINDOW_MS + 120);
    expect(onSelect).not.toHaveBeenCalled();
    expect(selection).toEqual([]);
  });

  it("ri05_ctrl_click_plus_double_click_never_clears_the_multi_selection", async () => {
    const { onSelect } = await mount({ initialSelection: ["other-1.exe", "other-2.exe"] });

    click("row-a", 1, true);
    click("row-a", 2, true);
    act(() => {
      container?.querySelector<HTMLElement>("#row-a")?.dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, detail: 2, ctrlKey: true }),
      );
    });
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect(onSelect).not.toHaveBeenCalled();
    expect([...selection].sort()).toEqual(["other-1.exe", "other-2.exe"]);
    expect(editingName()).toBe("a.exe");
  });

  it("ri06_unmounting_before_the_window_never_calls_back", async () => {
    const { onSelect } = await mount();
    click("row-a", 1);
    /* 挂起中卸载（关闭抽屉 / 切走页面）：定时器必须被清掉，否则回调打在已卸的父组件上 */
    act(() => root?.unmount());
    root = null;
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);
    expect(onSelect).not.toHaveBeenCalled();
  });

  /* ⑤ 慢速双击：窗口（260ms）已经过去，那一次选中**真的发生了**，只能事后补偿。
     "零调用"在这里物理上不可达（定时器必然先触发过），零调用的判据由 ri01（窗口内双击）负责；
     这里锁的是**净效果**：选中集与双击之前一模一样。 */
  it("ri07_a_slow_double_click_at_300ms_restores_the_selection", async () => {
    const { onSelect } = await mount();

    click("row-a", 1);
    await wait(300);
    click("row-a", 2);
    fireDoubleClick("row-a");
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect(selection, "净效果：与双击前一致（空集还是空集）").toEqual([]);
    expect(onSelect, "补偿确实发生了（1 次误选中 + 1 次还原）").toHaveBeenCalledTimes(2);
    expect(editingName(), "弹窗照常开在那一行上").toBe("a.exe");
  });

  it("ri08_a_slow_double_click_at_700ms_restores_the_selection", async () => {
    /* 700ms 远超窗口，也超过 Windows 默认双击阈值（500ms）的人手操作上限：
       两次点击之间定时器早就跑完，选中被翻了一次。 */
    const { onSelect } = await mount();

    click("row-a", 1);
    await wait(700);
    click("row-a", 2);
    fireDoubleClick("row-a");
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect(selection).toEqual([]);
    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(editingName()).toBe("a.exe");
  });

  it("ri08b_a_slow_double_click_restores_the_other_row_that_was_selected", async () => {
    /* 双击前选着别的行：那一下"替换"把它清掉了，补偿必须把它还回来（而不是只剩一行空选） */
    await mount({ initialSelection: ["other.exe"] });

    click("row-a", 1);
    await wait(700);
    click("row-a", 2);
    fireDoubleClick("row-a");
    await wait(DOUBLE_CLICK_WINDOW_MS + 120);

    expect(selection, "别的行要还原，被双击的行保持未选中").toEqual(["other.exe"]);
    expect(editingName()).toBe("a.exe");
  });

  it("ri09_two_consecutive_slow_double_clicks_stay_idempotent", async () => {
    /* 补偿必须幂等：连做两次"慢速双击"不许把选中翻成相反状态 */
    await mount();

    for (let round = 0; round < 2; round += 1) {
      click("row-a", 1);
      await wait(700);
      click("row-a", 2);
      fireDoubleClick("row-a");
      await wait(DOUBLE_CLICK_WINDOW_MS + 120);
      expect(selection, `第 ${round + 1} 轮之后仍应是空集`).toEqual([]);
    }
    expect(editingName()).toBe("a.exe");
  });
});
