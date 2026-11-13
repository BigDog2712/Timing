(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
// @ts-expect-error 项目未安装 @types/node（tsconfig 无 node 类型）；vitest 跑在 Node 上。
import { readFileSync } from "node:fs";
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
 * 慢速双击（D-2）与跨行连点（D-1）的**间隔分档回归**。
 *
 * 与相邻两份的分工：`useAppTrendRowEdit.interaction.test.tsx` 判"窗口内双击零调用、
 * 跨行连点不吞第一下"，`useAppTrendRowEdit.selectionRestore.test.tsx` 判"多选整份还原"；
 * 这里补的是**间隔维度**与**"第一次点击必须真的被兑现过"**：
 *   · 80 / 300 / 500 / 700ms 四档都要求"双击后选中集与双击前完全一致"；
 *   · 700ms 再补一条**不派发 dblclick** 的变体（Windows 默认阈值 500ms，超过就不是双击，
 *     此时两次独立单击都该生效，最终停在第二次那一行 —— 这是正确行为，不是缺陷）。
 *
 * 父组件按 `Data.tsx` 的真实语义实现：单击走 `replaceDataDestinationSelection`（单值替换，
 * 所以**非 Ctrl 的两次跨行点击最终只剩后者**，第一次的意义只在于"它被兑现过"），
 * Ctrl 走 `toggleDataDestinationSelection`（追加），还原走 `onRestoreSelection` 直写。
 */
const DOUBLE_CLICK_WINDOW_MS = 260;

function makeOption(key: string): DataDestinationTrendOption {
  return {
    key,
    displayName: key.replace(/\.exe$/, "").toUpperCase(),
    exeName: key,
    iconUrl: null,
    classificationCategory: "development",
    totalDuration: 0,
    percentage: 0,
    selected: false,
    color: "#315F9F",
    accentColor: "#315F9F",
  } as unknown as DataDestinationTrendOption;
}

const KEYS = ["a.exe", "b.exe", "c.exe", "d.exe"] as const;
const OPTIONS = KEYS.map(makeOption);

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let selection: string[] = [];
let editingExe = "";

interface HarnessProps {
  initialSelection: readonly string[];
  onSelect: (key: string, multi: boolean) => void;
}

function Harness({ initialSelection, onSelect }: HarnessProps) {
  const [keys, setKeys] = useState<string[]>([...initialSelection]);
  selection = keys;
  const handleSelect = (key: string, multi: boolean) => {
    onSelect(key, multi);
    const result = multi
      ? toggleDataDestinationSelection(keys, key)
      : replaceDataDestinationSelection(key);
    setKeys(result.keys);
  };
  const hook = useAppTrendRowEdit({
    editable: true,
    supportsDestinationDetails: true,
    selectedKeys: keys,
    onOptionSelect: handleSelect,
    onRestoreSelection: (next) => setKeys([...next]),
    onOptionOpenDetails: () => {},
  });
  editingExe = hook.editing?.exeName ?? "";
  return createElement("div", null,
    ...OPTIONS.map((option) => createElement(
      "button",
      { "data-row": option.key, type: "button", key: option.key, ...hook.handlers(option) },
      option.displayName,
    )),
    createElement("span", { id: "editing" }, editingExe));
}

async function mount(initialSelection: string[]) {
  const onSelect = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness, { initialSelection, onSelect }));
  });
  return { onSelect };
}

async function wait(ms: number) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function clickRow(key: string, detail: number, ctrlKey = false) {
  act(() => {
    container?.querySelector<HTMLElement>(`[data-row="${key}"]`)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail, ctrlKey }),
    );
  });
}

function fireDoubleClick(key: string) {
  act(() => {
    container?.querySelector<HTMLElement>(`[data-row="${key}"]`)?.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
    );
  });
}

/** 按给定间隔点两下，第二下带 `detail: 2`（= 浏览器认定这是一次双击） */
async function slowDoubleClick(key: string, gapMs: number) {
  clickRow(key, 1);
  await wait(gapMs);
  clickRow(key, 2);
  fireDoubleClick(key);
  await wait(DOUBLE_CLICK_WINDOW_MS + 140);
}

const sorted = () => [...selection].sort();
const editingName = () => container?.querySelector("#editing")?.textContent ?? "";

beforeEach(() => {
  selection = [];
  editingExe = "";
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("D-2 · 四档间隔的双击还原", () => {
  it("qf01_within_the_window_the_selection_is_untouched_and_nothing_fires", async () => {
    const { onSelect } = await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("b.exe", 80);

    expect(onSelect, "窗口内双击：一次选中都不许发生").not.toHaveBeenCalled();
    expect(sorted()).toEqual(["a.exe", "b.exe"]);
    expect(editingName()).toBe("b.exe");
  });

  it("qf02_at_300ms_the_selection_is_restored_even_though_the_first_click_already_landed", async () => {
    /* 260ms 窗口 < 300ms 间隔：第一下必然已经兑现（把集合塌成 [b]），
       双击到达后必须还原成 [a, b]。 */
    const { onSelect } = await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("b.exe", 300);

    expect(onSelect, "第一下点击确实兑现过（这是物理事实，不是缺陷）").toHaveBeenCalled();
    expect(sorted(), "双击后选中集必须与双击前完全一致").toEqual(["a.exe", "b.exe"]);
    expect(editingName()).toBe("b.exe");
  });

  it("qf03_at_500ms_the_selection_is_restored", async () => {
    await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("b.exe", 500);
    expect(sorted()).toEqual(["a.exe", "b.exe"]);
    expect(editingName()).toBe("b.exe");
  });

  it("qf04_at_700ms_a_dispatched_double_click_still_restores_the_selection", async () => {
    await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("b.exe", 700);
    expect(sorted()).toEqual(["a.exe", "b.exe"]);
    expect(editingName()).toBe("b.exe");
  });

  it("qf05_at_700ms_without_a_double_click_event_it_is_just_two_single_clicks", async () => {
    /* Windows 默认双击阈值 500ms：700ms 间隔时浏览器**不会**派发 dblclick，
       用户做的就是两次单击。此时不该开弹窗，两次点击都该被兑现，最终停在第二次那行。 */
    const { onSelect } = await mount(["a.exe", "b.exe"]);
    clickRow("b.exe", 1);
    await wait(700);
    clickRow("b.exe", 1);
    await wait(DOUBLE_CLICK_WINDOW_MS + 140);

    expect(onSelect).toHaveBeenCalledTimes(2);
    expect(sorted(), "两次独立单击（替换语义）= 只剩被点的那一行").toEqual(["b.exe"]);
    expect(editingName(), "没有 dblclick，不许开编辑弹窗").toBe("");
  });
});

describe("D-2 · 多选还原（上一轮才修好的路径）", () => {
  it("qf06_three_selected_then_double_clicking_one_of_them_keeps_all_three", async () => {
    await mount(["a.exe", "b.exe", "c.exe"]);
    await slowDoubleClick("b.exe", 300);
    expect(sorted(), "三个一个不少（顺序无关）").toEqual(["a.exe", "b.exe", "c.exe"]);
    expect(editingName()).toBe("b.exe");
  });

  it("qf07_two_selected_then_double_clicking_a_third_one_keeps_the_original_two", async () => {
    await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("d.exe", 300);

    expect(sorted()).toEqual(["a.exe", "b.exe"]);
    expect(selection, "被双击的那一行不许留在选中集里").not.toContain("d.exe");
    expect(editingName()).toBe("d.exe");
  });
});

describe("D-1 · 跨行连点", () => {
  it("qf08_ctrl_clicks_on_two_rows_keep_both", async () => {
    const { onSelect } = await mount(["a.exe"]);
    clickRow("b.exe", 1, true);
    await wait(160);
    clickRow("c.exe", 1, true);
    await wait(DOUBLE_CLICK_WINDOW_MS + 140);

    expect(sorted(), "Ctrl 连点 = 多选，两行都要在").toEqual(["a.exe", "b.exe", "c.exe"]);
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("qf09_plain_clicks_on_two_rows_honour_both_then_end_with_the_second", async () => {
    /* 非 Ctrl 是**替换**语义：最终只剩第二行是设计如此；但第一次点击必须真的被兑现过
       （`flushPending`），不能被静默吞掉 —— 否则用户会看到"点了两下只有一下有反应"。 */
    const { onSelect } = await mount([]);
    clickRow("a.exe", 1);
    await wait(160);
    clickRow("b.exe", 1);
    await wait(DOUBLE_CLICK_WINDOW_MS + 140);

    expect(onSelect, "两次点击都要兑现").toHaveBeenCalledTimes(2);
    expect(onSelect.mock.calls.map((call) => call[0]), "第一次是 a、第二次是 b").toEqual(["a.exe", "b.exe"]);
    expect(sorted(), "替换语义：最终只剩第二个").toEqual(["b.exe"]);
  });
});

describe("既有行为不许被这次重构带走（limit-reached / last-item 两条 toast）", () => {
  /* `Data.tsx` 把 `handleDestinationOptionSelect` 改成复用 `handleDestinationSelectionRestore`
     之后，两条 toast 的**触发条件**必须还在。这里分两步钉：
       ① 两个用户操作动词仍然产出这两个 outcome（行为源头没变）；
       ② `Data.tsx` 的那两条分支仍然存在，而**还原入口**里不许出现 toast。 */

  it("qf10_the_two_selection_verbs_still_produce_their_warning_outcomes", () => {
    expect(toggleDataDestinationSelection(["a.exe"], "a.exe").outcome, "只剩一项时不许取消")
      .toBe("last-item");
    const full = Array.from({ length: 64 }, (_, index) => `k${index}.exe`);
    expect(toggleDataDestinationSelection(full, "new.exe").outcome, "超过上限时不许再加")
      .toBe("limit-reached");
  });

  it("qf11_the_option_select_keeps_both_toast_branches_and_the_restore_path_has_none", () => {
    const source = readFileSync("src/windows/patina/features/data/components/Data.tsx", "utf8");
    const start = source.indexOf("const handleDestinationOptionSelect");
    /* 片段截到该 useCallback 的依赖数组（`}, [`）为止：函数体里也有 `const `，
       按 `const ` 切会把 toast 那两行切到片段外（这是我第一版的实现错误）。 */
    const end = source.indexOf("}, [", start);
    const selectBody = source.slice(start, end > start ? end : start + 2000);

    expect(selectBody, "limit-reached 的 toast 分支被弄丢了").toContain('result.outcome === "limit-reached"');
    expect(selectBody, "last-item 的 toast 分支被弄丢了").toContain('result.outcome === "last-item"');
    expect(selectBody).toContain("onToast?.");

    const restoreStart = source.indexOf("const handleDestinationSelectionRestore");
    const restoreEnd = source.indexOf("const handleDestinationOptionSelect");
    const restoreBody = source.slice(restoreStart, restoreEnd);
    expect(restoreBody, "还原入口不许弹 toast（它不是用户操作）").not.toContain("onToast");
    /* 三条 setter 各归其位：web / category / app */
    expect(restoreBody).toContain('presentedDestinationMode === "web"');
    expect(restoreBody).toContain('presentedDestinationMode === "category"');
    expect(restoreBody).toContain("setSelectedWebKeys");
    expect(restoreBody).toContain("setSelectedCategoryKeys");
    expect(restoreBody).toContain("setSelectedAppKeys");
  });
});
