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
 *
 * [第 6 条] 读的是 `loadAppItemBindingUnions()`（1:1 ∪ `__app_override::`）而不是 1:1 那份：
 * 只在应用设置弹窗里绑过的应用也必须有行标记（hook07）。主值规则 = `oneToOne ?? itemIds[0]`。
 */
interface UnionFixture {
  oneToOne: number | null;
  itemIds: number[];
  trackOff: boolean;
}

/** `{ exe: itemId }` → hook 吃的并集形态（1:1 视角，`oneToOne` = 那一条） */
function unionsOf(bindings: Record<string, number>): Record<string, UnionFixture> {
  const unions: Record<string, UnionFixture> = {};
  for (const [exeName, itemId] of Object.entries(bindings)) {
    unions[exeName] = { oneToOne: itemId, itemIds: [itemId], trackOff: false };
  }
  return unions;
}

const g = vi.hoisted(() => ({
  loadAppItemBindingUnions: vi.fn(),
  listAppItemBindingOptions: vi.fn(),
  saveAppItemBinding: vi.fn(),
  /* [0.13 fix] 存量绑定补镜像：应用卡读配置时顺手调一次（本文件不关心它的内部，
     但漏了这个导出 hook 会直接崩在 import 上）。[第 6 条] 它不再收调用方的视图。 */
  mirrorItemBindingsOnce: vi.fn(async () => undefined),
}));

vi.mock("../services/appItemBinding.ts", () => ({
  listAppItemBindingOptions: g.listAppItemBindingOptions,
  saveAppItemBinding: g.saveAppItemBinding,
}));

vi.mock("../services/appItemBindingMirror.ts", () => ({
  loadAppItemBindingUnions: g.loadAppItemBindingUnions,
  mirrorItemBindingsOnce: g.mirrorItemBindingsOnce,
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
  g.loadAppItemBindingUnions.mockReset();
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
    g.loadAppItemBindingUnions.mockResolvedValue(unionsOf({ "chrome.exe": 7 }));
    g.listAppItemBindingOptions.mockResolvedValue([{ id: 7, name: "写代码", color: "" }]);
    await mount();

    expect(latest!.bindings).toEqual({ "chrome.exe": 7 });
    expect(latest!.items).toEqual([{ id: 7, name: "写代码", color: "" }]);
    expect(latest!.itemsLoadFailed).toBe(false);
    expect(g.loadAppItemBindingUnions).toHaveBeenCalledTimes(1);
  });

  it("hook02_bindings_read_failure_degrades_to_empty_without_throwing", async () => {
    g.loadAppItemBindingUnions.mockRejectedValue(new Error("boom"));
    g.listAppItemBindingOptions.mockResolvedValue([{ id: 1, name: "开会", color: "" }]);
    await mount();

    /* 降级：空对象 + 事项清单照常（两段互不连坐）。 */
    expect(latest!.bindings).toEqual({});
    expect(latest!.items).toHaveLength(1);
    expect(latest!.itemsLoadFailed).toBe(false);
  });

  it("hook03_item_list_failure_degrades_to_empty_and_flags_it", async () => {
    g.loadAppItemBindingUnions.mockResolvedValue(unionsOf({ "chrome.exe": 7 }));
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
    g.loadAppItemBindingUnions.mockResolvedValue(unionsOf({ "chrome.exe": 7 }));
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockResolvedValue(undefined);
    await mount();

    await act(async () => { await latest!.setBinding("code.exe", 9); });

    expect(g.saveAppItemBinding).toHaveBeenLastCalledWith("code.exe", 9);
    expect(latest!.bindings).toEqual({ "chrome.exe": 7, "code.exe": 9 });
    expect(g.loadAppItemBindingUnions, "保存后整表重读了一次").toHaveBeenCalledTimes(1);
  });

  it("hook05_clear_removes_the_key", async () => {
    g.loadAppItemBindingUnions.mockResolvedValue(unionsOf({ "chrome.exe": 7 }));
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockResolvedValue(undefined);
    await mount();

    await act(async () => { await latest!.setBinding("chrome.exe", null); });

    expect(g.saveAppItemBinding).toHaveBeenLastCalledWith("chrome.exe", null);
    expect(latest!.bindings).toEqual({});
  });

  it("hook06_save_failure_propagates_and_keeps_state", async () => {
    g.loadAppItemBindingUnions.mockResolvedValue(unionsOf({ "chrome.exe": 7 }));
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockRejectedValue(new Error("db locked"));
    await mount();

    await expect(latest!.setBinding("chrome.exe", 9)).rejects.toThrow("db locked");
    expect(latest!.bindings, "写失败却改了本地状态（用户会以为存上了）").toEqual({ "chrome.exe": 7 });
  });
});

describe("[第 6 条] 行标记读并集", () => {
  it("hook07_只在应用设置弹窗里绑过（没有 1:1）也要出行标记", async () => {
    /* 变异自证：`bindings` 退回只用 `union.oneToOne` → 这里变成 `{}`（用户报的那个症状：
       弹窗里绑了「燕云」，排行卡的行上没有任何标记）。 */
    g.loadAppItemBindingUnions.mockResolvedValue({
      "yanyun.exe": { oneToOne: null, itemIds: [3, 9], trackOff: false },
    });
    g.listAppItemBindingOptions.mockResolvedValue([{ id: 3, name: "写代码", color: "" }]);
    await mount();

    expect(latest!.bindings).toEqual({ "yanyun.exe": 3 });
  });

  it("hook08_解绑摘掉的是并集里显示的那一个_别的事项留着", async () => {
    /* 界面显示主值 3 → 点「不绑定」必须摘 3（不是"什么都不摘"）；并集里的 9 原样留着。
       与 `planAppItemBindingWrite` 的 `removedItemId` fallback 是同一条规则。 */
    g.loadAppItemBindingUnions.mockResolvedValue({
      "yanyun.exe": { oneToOne: null, itemIds: [3, 9], trackOff: false },
    });
    g.listAppItemBindingOptions.mockResolvedValue([]);
    g.saveAppItemBinding.mockResolvedValue(undefined);
    await mount();

    await act(async () => { await latest!.setBinding("yanyun.exe", null); });

    expect(g.saveAppItemBinding).toHaveBeenLastCalledWith("yanyun.exe", null);
    expect(latest!.bindings).toEqual({ "yanyun.exe": 9 });
  });
});
