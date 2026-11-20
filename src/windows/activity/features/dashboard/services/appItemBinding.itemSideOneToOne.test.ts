import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * [0.12.6 · T5] 事项侧绑定必须**同时**写 1:1 主值（`__app_item_binding::<exe>`）。
 *
 * ## 缺口长什么样
 *
 * 绑定有两份真源：1:1 的 `__app_item_binding::<exe>` 与弹窗的
 * `__app_override::<exe>.itemBindings[]`。应用排行的**行标记**与"双击应用"的弹层都只认
 * 1:1，所以事项侧（「编辑事项 → 绑定应用」，`useItemAppBindings.bind`）如果只写 override，
 * 用户就会看到：事项那边显示"已绑定燕云"，应用排行那一行**什么也没有**，
 * 双击进去甚至还是"不绑定" —— 同一份配置在两个界面上给出相反答案。
 *
 * ## 这条用例钉的是**链路**，不是某一个函数
 *
 * 事项侧的写入口是 `saveAppItemBinding(exe, itemId)`（`useItemAppBindings.write` 唯一调用，
 * 见 `ItemAppBindingField` 的 `ai01`）。这里用一份**内存设置表**把它跑完，再用真正的
 * `loadAppItemBindingUnions()` 读回来 —— 断言落在"并集里的 `oneToOne` 等于当前事项"，
 * 也就是应用排行行标记与弹层看到的那一个值。
 *
 * 变异靶点：把 `saveAppItemBinding` 里 `if (itemId !== null || plan.clearOneToOne)
 * mutations.push({ key, value })` 的写入去掉（回到"只写 override"）→ 本条红
 * （`oneToOne` 变 `null`、内存表里没有 1:1 行）。
 */
const kv = new Map<string, string>();

const g = vi.hoisted(() => ({
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
  invalidateBootstrapCache: vi.fn(),
}));

vi.mock("../../../platform/persistence/classificationSettingsGateway", () => ({
  commitClassificationSettingMutations: async (
    mutations: readonly { key: string; value: string | null }[],
  ) => {
    for (const mutation of mutations) {
      if (mutation.value === null) kv.delete(mutation.key);
      else kv.set(mutation.key, mutation.value);
    }
  },
}));
vi.mock("../../../platform/persistence/settingsPersistence", () => ({
  loadSettingRows: async ({ keyPrefix }: { keyPrefix: string }) => [...kv.entries()]
    .filter(([key]) => key.startsWith(keyPrefix))
    .map(([key, value]) => ({ key, value })),
}));
vi.mock("../../../platform/runtime/hostIntentGateway", () => ({
  emitHostIntent: g.emitHostIntent,
}));
vi.mock("../classification/services/classificationService.ts", () => ({
  ClassificationService: { invalidateBootstrapCache: g.invalidateBootstrapCache },
}));

import { saveAppItemBinding } from "./appItemBinding.ts";
import { loadAppItemBindingUnions } from "./appItemBindingMirror.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";

const ONE_TO_ONE_KEY = "__app_item_binding::yanyun.exe";

beforeEach(() => {
  kv.clear();
  AppClassification.setAppLinks({});
  g.emitHostIntent.mockClear();
  g.invalidateBootstrapCache.mockClear();
});

describe("事项侧绑定 → 1:1 主值", () => {
  it("ad30_事项侧绑定后_并集里的 oneToOne 就是该事项", async () => {
    expect(await loadAppItemBindingUnions()).toEqual({});

    /* 正是 `useItemAppBindings.bind(exeName)` 打出去的那一次写 */
    await saveAppItemBinding("yanyun.exe", 9);

    expect(kv.get(ONE_TO_ONE_KEY), "1:1 键没被写 → 应用排行行上看不到标记").toBe('{"itemId":9}');
    const unions = await loadAppItemBindingUnions();
    expect(unions["yanyun.exe"].oneToOne).toBe(9);
    expect(unions["yanyun.exe"].itemIds).toEqual([9]);
  });

  it("ad31_事项侧解绑当前事项后_1:1 主值一起清掉", async () => {
    await saveAppItemBinding("yanyun.exe", 9);

    /* 第三个参数 = "这一次摘掉的是哪个事项"（事项视角必须显式给，见 `appItemBindingPlan`） */
    await saveAppItemBinding("yanyun.exe", null, 9);

    expect(kv.has(ONE_TO_ONE_KEY), "解绑了 1:1 指的那一条，键必须删掉").toBe(false);
    expect(await loadAppItemBindingUnions()).toEqual({});
  });

  it("ad32_事项侧绑定会镜像到宿主_载荷是并集而不是单条", async () => {
    await saveAppItemBinding("yanyun.exe", 9);

    /* 载荷走 `planAppItemBindingWrite.mirroredItemIds`（真全集）：自动计时读的就是这张表 */
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "yanyun.exe",
      itemIds: [9],
    });
  });
});
