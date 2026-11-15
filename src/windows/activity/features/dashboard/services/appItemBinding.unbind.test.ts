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
import { planAppItemBindingWrite } from "./appItemBindingPlan.ts";

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

    /* 升序（与并集 `itemIds` 同一顺序）：`[5, 7]`，不是"override 在前、新的追加在后" */
    expect(mirroredItemIds()).toEqual([5, 7]);
    /* 绑定不改 override（1:1 才是它的家），所以只写一个键 */
    expect(committed()).toEqual([{ key: BINDING_KEY, value: JSON.stringify({ itemId: 5 }) }]);
  });

  it("ad25_两份都读不到就不猜_读失败必须抛且一条写都不发", async () => {
    g.loadSettingRows.mockRejectedValue(new Error("KV down"));

    await expect(saveAppItemBinding("code.exe", null)).rejects.toThrow("KV down");
    expect(g.commit).not.toHaveBeenCalled();
    expect(g.emitHostIntent).not.toHaveBeenCalled();
  });

  /**
   * [第 6 条] override 型（**没有** 1:1）的解绑必须真的摘掉那一条。
   *
   * 界面显示的主值是 `oneToOne ?? itemIds[0]`（见 `useAppItemBindings`）：只在应用设置弹窗里
   * 绑过事项的应用，用户看到的就是 override 里那一条。若 `removedItemId` 仍然只认 1:1，
   * 这里会是 null → `remaining === base` → 一个键都不重写、载荷还是 `[7]`，用户视角就是
   * **「点了不绑定，界面上还在」**。变异自证：把 `planAppItemBindingWrite` 的 fallback
   * `?? base[0]` 去掉 → 这条红（override 没被重写、载荷仍是 `[7]`）。
   */
  it("ad26_override 型（没有 1:1）解绑_摘的是并集里显示的那一条", async () => {
    stubSources(null, [7]);

    await saveAppItemBinding("code.exe", null);

    expect(committed()).toContainEqual({ key: BINDING_KEY, value: null });
    /* 摘掉唯一的绑定 → override 整条删除（否则下次开机补镜像读回来） */
    expect(committed()).toContainEqual({ key: OVERRIDE_KEY, value: null });
    expect(mirroredItemIds()).toEqual([]);
  });

  /**
   * [第 6 条] 事项视角的解绑必须摘**当前事项**，而不是"1:1 指的那一条"。
   *
   * 应用同时绑了 3（1:1）与 9（override），用户在事项 9 上点解绑（第三个参数 = 9）：
   *   · 摘 9（override 重写成 [3]）、载荷 `[3]`；
   *   · **1:1 键一行都不能动** —— 它指的是 3，用户没碰那一条。
   * 变异自证：把 `removeItemId ??` 从计划里去掉 → 摘成 3（override 变 [9]、载荷 `[9]`），
   * 第二条断言红；把 `clearOneToOne` 恒 true → 第一条断言红（KV 被删）。
   */
  it("ad27_事项视角解绑摘的是当前事项_不碰 1:1 指的是别的", async () => {
    stubSources(3, [3, 9]);

    await saveAppItemBinding("code.exe", null, 9);

    const writes = committed();
    expect(writes, "1:1 指的是事项 3，解绑事项 9 不该删它").not.toContainEqual({
      key: BINDING_KEY,
      value: null,
    });
    const overrideWrite = writes.find((entry) => entry.key === OVERRIDE_KEY);
    expect(overrideWrite, "override 里的事项 9 没被摘 → 下次读库它又回来").toBeTruthy();
    expect(JSON.parse(String(overrideWrite?.value)).itemBindings).toEqual([{ itemId: 3 }]);
    expect(mirroredItemIds()).toEqual([3]);
  });

  /**
   * [QA 验收 · P0] **1:1 不在 override 里**时，解绑别的事项不能把 1:1 从载荷里漏掉。
   *
   * 可达路径（全是正常 UI）：应用设置弹窗先绑 9（override=[9]）→ 排行卡再绑 3
   * （1:1=3、载荷 [3,9]）→ 事项面板在 9 上解绑（`removeItemId=9`）。
   * 只按 `remaining`（= override 去掉 9 = `[]`）发载荷，就等于发"**空全集**"：执行端的三向 diff
   * 会删掉事项 3 的 `item_app` 行，而 KV 里 1:1=3 没动、并集读法的界面照旧显示"已绑定 3" ——
   * 用户看到的正是本次要修的那个症状的另一半（界面绑着、切过去不计时），且要等重启才自愈。
   * `ad22` / `ad27` 的夹具都是 **1:1 ⊆ override**，1:1 项天然躺在 `remaining` 里，抓不住这一格。
   * 变异自证：去掉 `survivors` 的并入（退回 `mirrored = remaining`）→ 本条红（载荷变 `[]`）。
   */
  it("ad28_1:1 不在 override 里时_解绑别的事项_载荷必须留着 1:1 那一条", async () => {
    stubSources(3, [9]);

    await saveAppItemBinding("code.exe", null, 9);

    const writes = committed();
    /* 1:1 仍指 3（`clearOneToOne === false`）→ KV 一行都不能动 */
    expect(writes, "1:1 指向 3，解绑 9 不该删这条 KV").not.toContainEqual({
      key: BINDING_KEY,
      value: null,
    });
    /* override 里只有 9，摘掉就整条没了 */
    expect(writes).toContainEqual({ key: OVERRIDE_KEY, value: null });
    /* 载荷的真全集 = {3}（1:1 存活项），不是 [] */
    expect(mirroredItemIds()).toEqual([3]);
  });

  /**
   * [护栏] "最后一条被摘掉"才允许出现空载荷、才允许删 1:1 键。
   *
   * R1 的修法是"把存活的 1:1 并回载荷"——如果顺手也并回了 `removedItemId === previousItemId`
   * 的那一格，就会出现"摘完又加回来"（解绑永不生效）。这条按**两步骤**钉住边界：
   *   ① 1:1=3 / override=[3,9]，摘 9 → 3 还活着：载荷 `[3]`、`clearOneToOne === false`、KV 不动；
   *   ② override 已被重写成 [3]，再摘 3 → 真没了：载荷 `[]`、`clearOneToOne === true`、两个键一起删。
   * 变异自证：把 `survivors` 改成无条件 `[args.previousItemId]`（连"要摘的就是它"也并回）
   * → 步骤 ② 的载荷变 `[3]`（解绑放不出去），本条红。
   */
  it("ad29_同一应用最后一条被摘掉时才是空载荷_且此时才删 1:1 键", async () => {
    /* ① 摘掉 override 里的 9，1:1 指的 3 必须留在载荷里 */
    stubSources(3, [3, 9]);
    const first = planAppItemBindingWrite({
      nextItemId: null,
      previousItemId: 3,
      overrideItemIds: [3, 9],
      removeItemId: 9,
    });
    expect(first.mirroredItemIds).toEqual([3]);
    expect(first.clearOneToOne).toBe(false);

    await saveAppItemBinding("code.exe", null, 9);
    expect(mirroredItemIds()).toEqual([3]);
    expect(committed(), "1:1 还在用，不许删").not.toContainEqual({ key: BINDING_KEY, value: null });

    /* ② override 此时只剩 [3]，再把 3 摘掉 → 这一个应用真的空了 */
    g.commit.mockClear();
    g.emitHostIntent.mockClear();
    stubSources(3, [3]);
    const second = planAppItemBindingWrite({
      nextItemId: null,
      previousItemId: 3,
      overrideItemIds: [3],
      removeItemId: 3,
    });
    expect(second.mirroredItemIds, "摘的就是 1:1 那条 → 载荷才允许为空").toEqual([]);
    expect(second.clearOneToOne).toBe(true);

    await saveAppItemBinding("code.exe", null, 3);
    expect(mirroredItemIds()).toEqual([]);
    expect(committed()).toContainEqual({ key: BINDING_KEY, value: null });
    expect(committed()).toContainEqual({ key: OVERRIDE_KEY, value: null });
  });
});
