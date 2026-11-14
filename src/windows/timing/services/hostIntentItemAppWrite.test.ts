/**
 * 「应用 ↔ 事项绑定」意图执行端的判据（[0.13 fix] 燕云启动了却不计时）。
 *
 * 这条链是**镜像写**：分析窗把「这个应用绑了哪几个事项」的全集发过来，药丸把宿主
 * `item_app` 里该应用那一侧拉成同一份事实（自动接管只读这张表）。
 *
 * 判据钉的是**三向 diff 的边界**，不是"函数跑过了"：
 *   ① 少了 → `bind_item_app`（`track` 缺省 1，这是自动接管的唯一判据）；
 *   ② 多了 → `unbind_item_app`（**别的应用**的绑定一根都不许动）；
 *   ③ 已有但 `track` 变了 → 重 `bind`（"仅观察 → 计入"要能改回来）；
 *   ④ 空载荷 = 全解绑；脏 id 静默丢弃（来自另一个窗，抛错只会在药丸上弹看不懂的错）；
 *   ⑤ 失败只弹药丸 `setNotice(danger)`。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

interface Binding {
  itemId: number;
  appKey: string;
  track: number;
}

const h = vi.hoisted(() => ({
  listItemsForApp: vi.fn(async (_params: { appKey: string }) => [] as Binding[]),
  bindItemApp: vi.fn(async (_params: { itemId: number; appKey: string; track?: number }) => ({
    itemId: 0,
    appKey: "",
    track: 1,
  })),
  unbindItemApp: vi.fn(async (_params: { itemId: number; appKey: string }) => true),
  setNotice: vi.fn(),
}));

vi.mock("./ipc", () => ({
  ipc: {
    listItemsForApp: h.listItemsForApp,
    bindItemApp: h.bindItemApp,
    unbindItemApp: h.unbindItemApp,
  },
  errorText: (error: unknown) => (error instanceof Error ? error.message : "unknown"),
}));

vi.mock("../stores/uiStore", () => ({
  useUiStore: { getState: () => ({ setNotice: h.setNotice }) },
}));

const { applySyncAppItemBindingsIntent, normalizeBoundItemIds } = await import(
  "./hostIntentItemAppWrite"
);

const binding = (itemId: number, track = 1): Binding => ({ itemId, appKey: "yanyun.exe", track });

beforeEach(() => {
  h.listItemsForApp.mockReset();
  h.listItemsForApp.mockResolvedValue([]);
  h.bindItemApp.mockClear();
  h.unbindItemApp.mockClear();
  h.setNotice.mockClear();
});

describe("normalizeBoundItemIds", () => {
  it("ai01_丢掉脏值与重复项并升序_顺序确定才不会被数据库返回顺序左右", () => {
    expect(normalizeBoundItemIds([7, 3, 3, 0, -2, 1.5, 9])).toEqual([3, 7, 9]);
    expect(normalizeBoundItemIds(undefined)).toEqual([]);
  });
});

describe("applySyncAppItemBindingsIntent", () => {
  it("ai02_没有的绑定补上_track_缺省为_1_已有的一条不动", async () => {
    h.listItemsForApp.mockResolvedValue([binding(5)]);
    await applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [5, 7] });

    expect(h.bindItemApp).toHaveBeenCalledTimes(1);
    expect(h.bindItemApp).toHaveBeenCalledWith({ itemId: 7, appKey: "yanyun.exe", track: 1 });
    expect(h.unbindItemApp).not.toHaveBeenCalled();
  });

  it("ai03_多出来的解绑_空载荷等于全部解绑", async () => {
    h.listItemsForApp.mockResolvedValue([binding(5), binding(8)]);
    await applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [5] });
    expect(h.unbindItemApp).toHaveBeenCalledWith({ itemId: 8, appKey: "yanyun.exe" });

    h.unbindItemApp.mockClear();
    await applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [] });
    expect(h.unbindItemApp).toHaveBeenCalledTimes(2);
    expect(h.bindItemApp).not.toHaveBeenCalled();
  });

  it("ai04_track_从仅观察改成计入时重绑_而不是当作已存在跳过", async () => {
    h.listItemsForApp.mockResolvedValue([binding(5, 0)]);
    await applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [5] });
    expect(h.bindItemApp).toHaveBeenCalledWith({ itemId: 5, appKey: "yanyun.exe", track: 1 });
  });

  it("ai05_应用被标成不计入时按_track_0_写_不覆盖用户别接管的意图", async () => {
    await applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [5], track: 0 });
    expect(h.bindItemApp).toHaveBeenCalledWith({ itemId: 5, appKey: "yanyun.exe", track: 0 });
  });

  it("ai06_空应用键一个_IPC_都不打", async () => {
    await applySyncAppItemBindingsIntent({ appKey: "   ", itemIds: [5] });
    expect(h.listItemsForApp).not.toHaveBeenCalled();
    expect(h.bindItemApp).not.toHaveBeenCalled();
  });

  it("ai07_失败只弹药丸的_danger_提示_不抛给调用方", async () => {
    h.listItemsForApp.mockRejectedValue(new Error("db locked"));
    await expect(
      applySyncAppItemBindingsIntent({ appKey: "yanyun.exe", itemIds: [5] }),
    ).resolves.toBeUndefined();
    expect(h.setNotice).toHaveBeenCalledWith({ text: "db locked", tone: "danger" });
  });
});
