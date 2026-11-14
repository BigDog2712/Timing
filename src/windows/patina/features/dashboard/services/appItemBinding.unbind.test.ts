import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [R1] 「1:1 解绑」的判据：载荷必须是**真全集**，且 override 里那一份也要一起摘掉。
 *
 * ## 它守的是一对互相放大的失效
 *
 * 绑定有两份真源：1:1 的 `__app_item_binding::<exe>` 与弹窗的
 * `__app_override::<exe>.itemBindings[]`。应用设置弹窗保存过一次之后，同一个事项会**同时**
 * 出现在两份里。此时用户在事项编辑里解绑：
 *
 *   · 若只删 1:1 然后发 `itemIds: []` → 执行端把 `[]` 当真全集，**同应用另一个事项**
 *     的行一起被解绑（当次就不自动计时了）；
 *   · 若只删 1:1、不摘 override → 下次开机启动补镜像读 override，把这条**补回来**
 *     （用户看到"我解绑了，重启又自动计时"）。
 *
 * 所以两条判据都断言**两处**：`commit` 里的两个键 + `emitHostIntent` 的载荷。
 * 变异自证：把 `planAppItemBindingWrite` 的 `mirroredItemIds` 改回
 * `nextItemId === null ? [] : [nextItemId]` → `ad22` 红；把 `rewriteOverride` 恒 false →
 * `ad22` 的 commit 断言红（只剩一个键）。
 */
const g = vi.hoisted(() => ({
  commit: vi.fn(async (_mutations: unknown): Promise<void> => undefined),
  loadSettingRows: vi.fn(),
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
  invalidateBootstrapCache: vi.fn(),
}));

vi.mock("../../../platform/persistence/classificationSettingsGateway", () => ({
  commitClassificationSettingMutations: g.commit,
}));
vi.mock("../../../platform/runtime/hostIntentGateway", () => ({
  emitHostIntent: g.emitHostIntent,
}));
vi.mock("../../../platform/persistence/settingsPersistence", () => ({
  loadSettingRows: g.loadSettingRows,
}));
vi.mock("../classification/services/classificationService.ts", () => ({
  ClassificationService: { invalidateBootstrapCache: g.invalidateBootstrapCache },
}));

import { saveAppItemBinding } from "./appItemBinding.ts";

const BINDING_KEY = "__app_item_binding::code.exe";
const OVERRIDE_KEY = "__app_override::code.exe";

/** 按前缀分别回：1:1 那条 + override 那条（两条真源在不同的行上） */
function stubSources(single: number | null, overrideItemIds: readonly number[]): void {
  g.loadSettingRows.mockImplementation(async ({ keyPrefix }: { keyPrefix: string }) => {
    if (keyPrefix === BINDING_KEY) {
      return single === null ? [] : [{ key: BINDING_KEY, value: JSON.stringify({ itemId: single }) }];
    }
    if (keyPrefix === OVERRIDE_KEY) {
      return [{
        key: OVERRIDE_KEY,
        value: JSON.stringify({
          enabled: true,
          updatedAt: 1,
          itemBindings: overrideItemIds.map((itemId) => ({ itemId })),
        }),
      }];
    }
    return [];
  });
}

/** `commit` 收到的 mutations（按调用顺序摊平） */
function committed(): { key: string; value: string | null }[] {
  return g.commit.mock.calls.flatMap((call) => call[0] as { key: string; value: string | null }[]);
}

/** 某次保存发出去的镜像载荷 */
function mirroredItemIds(): readonly number[] {
  const intent = g.emitHostIntent.mock.calls.at(-1)?.[0] as { itemIds?: readonly number[] } | undefined;
  return intent?.itemIds ?? [];
}

beforeEach(() => {
  g.commit.mockReset();
  g.commit.mockResolvedValue(undefined);
  g.loadSettingRows.mockReset();
  g.emitHostIntent.mockReset();
  g.emitHostIntent.mockResolvedValue(true);
  g.invalidateBootstrapCache.mockReset();
});

describe("[R1] 事项视角解绑：一次 commit 两个键，载荷用真全集", () => {
  it("ad22_override 还有别的事项时_解绑只摘掉那一条_载荷不是空全集", async () => {
    stubSources(5, [5, 7]);

    await saveAppItemBinding("code.exe", null);

    const writes = committed();
    /* ① 1:1 键删掉 */
    expect(writes).toContainEqual({ key: BINDING_KEY, value: null });
    /* ② override 里把 5 摘掉、7 原样留着（不摘的话开机补镜像会复活 5） */
    const overrideWrite = writes.find((entry) => entry.key === OVERRIDE_KEY);
    expect(overrideWrite, "override 没被重写 → 重启会复活那条解绑").toBeTruthy();
    expect(JSON.parse(String(overrideWrite?.value)).itemBindings).toEqual([{ itemId: 7 }]);
    /* ③ 载荷是真全集 [7]，不是 []（发 [] 会把 7 也解绑） */
    expect(mirroredItemIds()).toEqual([7]);
  });

  it("ad23_override 只有这一条时_载荷为空全集_override 整条删掉", async () => {
    stubSources(5, [5]);

    await saveAppItemBinding("code.exe", null);

    expect(committed()).toContainEqual({ key: BINDING_KEY, value: null });
    /* 摘完没有任何维度了 → 走 `buildQuickAppOverride` 的"整条置 null"，删键而不是留空对象 */
    expect(committed()).toContainEqual({ key: OVERRIDE_KEY, value: null });
    expect(mirroredItemIds()).toEqual([]);
  });

  it("ad24_override 里有别的事项时_绑定只加不删（载荷带全集）", async () => {
    /* 这条是 ad22 的镜像：绑定也不能冒充全集，否则同应用别的事项当次失去自动计时 */
    stubSources(null, [7]);

    await saveAppItemBinding("code.exe", 5);

    expect(mirroredItemIds()).toEqual([7, 5]);
    /* 绑定不改 override（1:1 才是它的家），所以只写一个键 */
    expect(committed()).toEqual([{ key: BINDING_KEY, value: JSON.stringify({ itemId: 5 }) }]);
  });

  it("ad25_两份都读不到就不猜_读失败必须抛且一条写都不发", async () => {
    g.loadSettingRows.mockRejectedValue(new Error("KV down"));

    await expect(saveAppItemBinding("code.exe", null)).rejects.toThrow("KV down");
    expect(g.commit).not.toHaveBeenCalled();
    expect(g.emitHostIntent).not.toHaveBeenCalled();
  });
});
