(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「绑定事项」状态的降级口径（0.12.1）。
 *
 * 三条纪律（hook 注释里写了，这里钉住）：
 *   1. 挂载只读一次前缀扫描，保存后**局部**更新（不整表重读）；
 *   2. 读不到不许把主界面拖红 —— 绑定是锦上添花，排行才是本体的；
 *   3. `setBinding` 的写失败必须**抛回去**（弹层要靠它说「保存失败」），不许吞。
 *
 * 第 2、3 条是最容易嘴上过的：吞掉错误 / 静默降级成空，界面看上去一切正常。
 */
const g = vi.hoisted(() => ({
  loadAppItemBindings: vi.fn(),
  listAppItemBindingOptions: vi.fn(),
  saveAppItemBinding: vi.fn(),
}));

vi.mock("../services/appItemBinding.ts", () => ({
  loadAppItemBindings: g.loadAppItemBindings,
  listAppItemBindingOptions: g.listAppItemBindingOptions,
  saveAppItemBinding: g.saveAppItemBinding,
}));

import { useAppItemBindings, type AppItemBindingsState } from "./useAppItemBindings.ts";

let container: HTMLDivElement | null = null;
let root: Root | null = null;
let latest: AppItemBindingsState | null = null;

function Probe() {
  latest = useAppItemBindings();
  return null;
}

async function mount(): Promise<void> {
  await act(async () => { root?.render(createElement(Probe)); });
  /* 两轮微任务：`Promise.all([...])` 里两个分支各自 await 一次。 */
  await act(async () => { await Promise.resolve(); });
  await act(async () => { await Promise.resolve(); });
}

beforeEach(() => {
  g.loadAppItemBindings.mockReset();
  g.listAppItemBindingOptions.mockReset();
  g.saveAppItemBinding.mockReset();
  latest = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  container = null;
  root = null;
});

describe("挂载读取", () => {
  it("hook01_reads_bindings_and_options_once", async () => {
    g.loadAppItemBindings.mockResolvedValue({ "chrome.exe": 7 });
    g.listAppItemBindingOptions.mockResolvedValue([{ id: 7, name: "写代码", color: "" }]);
    await mount();

    expect(latest!.bindings).toEqual({ "chrome.exe": 7 });
    expect(latest!.items).toEqual([{ id: 7, name: "写代码", color: "" }]);
    expect(latest!.itemsLoadFailed).toBe(false);
    expect(g.loadAppItemBindings).toHaveBeenCalledTimes(1);
  });

  it("hook02_bindings_read_failure_degrades_to_empty_without_throwing", async () => {
    g.loadAppItemBindings.mockRejectedValue(new Error("boom"));
    g.listAppItemBindingOptions.mockResolvedValue([{ id: 1, name: "开会", color: "" }]);
    await mount();

    /* 降级：空对象 + 事项清单照常（两段互不连坐）。 */
    expect(latest!.bindings).toEqual({});
    expect(latest!.items).toHaveLength(1);
    expect(latest!.itemsLoadFailed).toBe(false);
  });

  it("hook03_item_list_failure_degrades_to_empty_and_flags_it", async () => {
    g.loadAppItemBindings.mockResolvedValue({ "chrome.exe": 7 });
    g.listAppItemBindingOptions.mockRejectedValue(new Error("boom"));
    await mount();

    expect(latest!.itemsLoadFailed, "事项清单读失败必须置位（弹层要显示降级文案）").toBe(true);
    expect(latest!.items).toEqual([]);
    /* 绑定本身照旧可用 —— 只是没法显示事项名。 */
    expect(latest!.bindings).toEqual({ "chrome.exe": 7 });
  });
});

describe("保存", () => {
  it("hook04_save_updates_only_that_key_and_does_not_reload", async () => {
    g.loadAppItemBindings.mockResolvedValue({ "chrome.exe": 7 });
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockResolvedValue(undefined);
    await mount();

    await act(async () => { await latest!.setBinding("code.exe", 9); });

    expect(g.saveAppItemBinding).toHaveBeenLastCalledWith("code.exe", 9);
    expect(latest!.bindings).toEqual({ "chrome.exe": 7, "code.exe": 9 });
    expect(g.loadAppItemBindings, "保存后整表重读了一次").toHaveBeenCalledTimes(1);
  });

  it("hook05_clear_removes_the_key", async () => {
    g.loadAppItemBindings.mockResolvedValue({ "chrome.exe": 7 });
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockResolvedValue(undefined);
    await mount();

    await act(async () => { await latest!.setBinding("chrome.exe", null); });

    expect(g.saveAppItemBinding).toHaveBeenLastCalledWith("chrome.exe", null);
    expect(latest!.bindings).toEqual({});
  });

  it("hook06_save_failure_propagates_and_keeps_state", async () => {
    g.loadAppItemBindings.mockResolvedValue({ "chrome.exe": 7 });
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockRejectedValue(new Error("db locked"));
    await mount();

    await expect(latest!.setBinding("chrome.exe", 9)).rejects.toThrow("db locked");
    expect(latest!.bindings, "写失败却改了本地状态（用户会以为存上了）").toEqual({ "chrome.exe": 7 });
  });
});
