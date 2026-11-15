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
 * 慢速双击的**多选还原**判据（D-2 第二次返工）。
 *
 * 主路径：用户多选几个应用看趋势，再双击其中一个去改分类；回来时选中集必须原样还在。
 * 旧实现只能用 `replace` 还原一个 key（那是最弱的那条命令），多选必丢 —— 这里的 ri10/ri11
 * 专门钉死"整份集合还原"。
 *
 * 模型与 `Data.tsx` 同构：
 *   · 用户点击走 `replace` / `toggle` 两个动词（带 last-item 守卫），并按 outcome 弹 toast；
 *   · 还原走 `onRestoreSelection` 直写（一条命令写整份集合，不弹 toast）。
 * ri12 的 `onToast` 零调用就是在钉"还原不是用户操作，不许弹警告"。
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
  onToast: (message: string, tone: string) => void;
}

function Harness({ initialSelection, onSelect, onToast }: HarnessProps) {
  const [keys, setKeys] = useState<string[]>([...initialSelection]);
  selection = keys;
  const handleSelect = (key: string, multi: boolean) => {
    onSelect(key, multi);
    const result = multi
      ? toggleDataDestinationSelection(keys, key)
      : replaceDataDestinationSelection(key);
    /* 与 `Data.tsx` 一致：这两种 outcome 会弹警告 toast */
    if (result.outcome === "limit-reached") onToast("limit", "warning");
    else if (result.outcome === "last-item") onToast("last-item", "warning");
    setKeys(result.keys);
  };
  const hook = useAppTrendRowEdit({
    editable: true,
    supportsDestinationDetails: true,
    selectedKeys: keys,
    onOptionSelect: handleSelect,
    /* 直写：整份集合一次写完，不经过 replace/toggle，也不弹 toast */
    onRestoreSelection: (next) => setKeys([...next]),
    onOptionOpenDetails: () => {},
  });
  editingExe = hook.editing?.exeName ?? "";
  return createElement("div", null,
    ...OPTIONS.map((option) => createElement(
      "button",
      /* 用 data-row 而不是 id：key 里带 `.exe`，`#row-c.exe` 会被当成"id+class"选择器 */
      { "data-row": option.key, type: "button", key: option.key, ...hook.handlers(option) },
      option.displayName,
    )),
    createElement("span", { id: "editing" }, editingExe));
}

async function mount(initialSelection: string[]) {
  const onSelect = vi.fn();
  const onToast = vi.fn();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(createElement(Harness, { initialSelection, onSelect, onToast }));
  });
  return { onSelect, onToast };
}

async function wait(ms: number) {
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, ms)); });
}

function clickRow(key: string, detail: number) {
  act(() => {
    container?.querySelector<HTMLElement>(`[data-row="${key}"]`)?.dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail }),
    );
  });
}

/** 慢速双击：两次点击间隔远超推迟窗口（定时器必然先兑现一次选中） */
async function slowDoubleClick(key: string, gapMs = 700) {
  clickRow(key, 1);
  await wait(gapMs);
  clickRow(key, 2);
  act(() => {
    container?.querySelector<HTMLElement>(`[data-row="${key}"]`)?.dispatchEvent(
      new MouseEvent("dblclick", { bubbles: true, detail: 2 }),
    );
  });
  await wait(DOUBLE_CLICK_WINDOW_MS + 120);
}

const sortedSelection = () => [...selection].sort();
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

describe("慢速双击 · 多选还原", () => {
  it("ri10_restores_all_three_selected_rows_after_double_clicking_one_of_them", async () => {
    /* 主路径：选了 3 个看趋势，双击其中一个改分类 → 回来必须还是这 3 个 */
    await mount(["a.exe", "b.exe", "c.exe"]);
    await slowDoubleClick("c.exe");

    expect(sortedSelection(), "三项全等（顺序无关）").toEqual(["a.exe", "b.exe", "c.exe"]);
    expect(editingName(), "弹窗开在被双击的那一行").toBe("c.exe");
  });

  it("ri11_restores_the_selection_after_double_clicking_a_row_outside_it", async () => {
    /* 双击的那行不在选中集里：它被"替换"进选中集，回来后原来的两项必须还在、它必须不在 */
    await mount(["a.exe", "b.exe"]);
    await slowDoubleClick("d.exe");

    expect(sortedSelection()).toEqual(["a.exe", "b.exe"]);
    expect(selection, "被双击的行不许留在选中集里").not.toContain("d.exe");
    expect(editingName()).toBe("d.exe");
  });

  it("ri12_restoring_the_selection_never_raises_a_toast", async () => {
    /* 还原不是用户操作：既不该被 last-item 守卫挡掉（那样会弹"至少保留一个"），
       也不该因为超过数量上限弹提示。 */
    const { onToast } = await mount(["a.exe", "b.exe", "c.exe"]);
    await slowDoubleClick("c.exe");

    expect(onToast, "还原路径不许弹任何 toast").not.toHaveBeenCalled();
    expect(sortedSelection()).toEqual(["a.exe", "b.exe", "c.exe"]);
  });
});
