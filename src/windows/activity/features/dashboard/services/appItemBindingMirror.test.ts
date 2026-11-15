import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * **真全集**（1:1 ∪ override）与**存量补镜像**（[第 6 条]，`appItemBindingMirror.ts`）。
 *
 * 这一组钉住的是本轮那个 P0：补镜像曾经的载荷是**每个应用一条 `[itemId]`**（1:1 视角），
 * 而执行端（`hostIntentItemAppWrite::applySyncAppItemBindingsIntent`）把载荷当**该应用的
 * 全集**做三向 diff —— "不在载荷里"的其它事项会被 `unbindItemApp` 删掉。
 * 用户能感知的形态是：**打开一次事项面板，那个应用在别的事项上的绑定没了**。
 *
 * 所以判据不能停在"发了镜像"，必须停在**载荷内容**：
 *   · 1:1 = 12、override = [12, 7] → 载荷必须是 `[7, 12]`（并集），不是 `[12]`；
 *   · 只在应用设置里绑过（override 型、没有 1:1）的应用也要发；
 *   · override 标了「不计入」→ `track: 0`（否则"我故意不让它接管"被覆盖成接管）。
 *
 * 变异自证：把载荷退回 `[union.oneToOne]`（= 第 6 条之前的 `[itemId]`）→ ai05 红；
 * 把 `loadAppOverrideBindingSources` 从并集里摘掉 → ai05 / ai09 红。
 */
const g = vi.hoisted(() => ({
  commit: vi.fn(),
  loadSettingRows: vi.fn(),
  listTimingItems: vi.fn(),
  emitHostIntent: vi.fn(async (_intent: unknown) => true),
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
vi.mock("../../../platform/persistence/timingReadRepository", () => ({
  listTimingItems: g.listTimingItems,
}));

import {
  loadAppItemBindingUnions,
  mirrorItemBindingsOnce,
} from "./appItemBindingMirror.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";

/** `loadSettingRows` 一次只按一个前缀读：这里按前缀分发，免得两个来源互相污染 */
function stubSettings(rowsByPrefix: Record<string, { key: string; value: string }[]>): void {
  g.loadSettingRows.mockImplementation(
    async (options: { keyPrefix: string }) => rowsByPrefix[options.keyPrefix] ?? [],
  );
}

beforeEach(() => {
  AppClassification.setAppLinks({});
  g.commit.mockReset();
  g.loadSettingRows.mockReset();
  g.loadSettingRows.mockResolvedValue([]);
  g.listTimingItems.mockReset();
  g.emitHostIntent.mockReset();
  g.emitHostIntent.mockResolvedValue(true);
});

/**
 * 一条用例走完三段（补镜像**进程内只跑一次**，所以不能拆成三条互相依赖的用例）：
 *   ① 发失败**不缓存** → 下次进界面还能重试；
 *   ② 重试成功 → 每个应用发一次**并集**（这是本轮的 P0 判据）；
 *   ③ 第三次 → 进程内不再发（不重复打扰宿主）。
 */
describe("存量绑定补镜像（[第 6 条] 载荷 = 并集）", () => {
  it("ai05_失败可重试_成功后按并集发且进程内不再发", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    stubSettings({
      "__app_item_binding::": [
        { key: "__app_item_binding::yanyun.exe", value: '{"itemId":12}' },
        { key: "__app_item_binding::code.exe", value: '{"itemId":7}' },
      ],
      /* 燕云在应用设置弹窗里还绑着 7（→ 并集 [7,12]）；Chrome 只在弹窗里绑过，
         没有 1:1，并且被标成「不计入」 */
      "__app_override::": [
        { key: "__app_override::yanyun.exe", value: '{"itemBindings":[{"itemId":12},{"itemId":7}]}' },
        { key: "__app_override::chrome.exe", value: '{"track":false,"itemBindings":[{"itemId":9}]}' },
      ],
    });

    g.emitHostIntent.mockRejectedValueOnce(new Error("pill not ready"));
    await mirrorItemBindingsOnce();
    /* 失败要**报出来**且**不缓存**（置回 null 靠的就是这条 catch 分支） */
    expect(warn, "补镜像失败必须 warn 一次，且不缓存").toHaveBeenCalledTimes(1);

    g.emitHostIntent.mockClear();
    g.emitHostIntent.mockResolvedValue(true);
    await mirrorItemBindingsOnce();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(g.emitHostIntent).toHaveBeenCalledTimes(3);
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "yanyun.exe",
      itemIds: [7, 12],
    });
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "code.exe",
      itemIds: [7],
    });
    /* override 型（没有 1:1）+ 「不计入」→ 显式 `track: 0` */
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "chrome.exe",
      itemIds: [9],
      track: 0,
    });

    g.emitHostIntent.mockClear();
    await mirrorItemBindingsOnce();
    expect(g.emitHostIntent, "补镜像在进程内应当只跑一次").not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("真全集 loadAppItemBindingUnions", () => {
  it("ai09_并集与键归一_override 的 canonical 键并进统计应用", async () => {
    AppClassification.setAppLinks({ "code-insiders.exe": "code.exe" });
    stubSettings({
      "__app_item_binding::": [
        { key: "__app_item_binding::code.exe", value: '{"itemId":3}' },
      ],
      "__app_override::": [
        /* 成员 exe 的 override 必须并进父应用那条（与 1:1 同一个键空间） */
        { key: "__app_override::code-insiders.exe", value: '{"itemBindings":[{"itemId":5},{"itemId":3}]}' },
        /* 没有 itemBindings 的 override（只改过颜色 / 分类）不进并集，也不该造出一条空应用 */
        { key: "__app_override::paint.exe", value: '{"category":"office"}' },
      ],
    });

    const unions = await loadAppItemBindingUnions();
    expect(Object.keys(unions).sort()).toEqual(["code.exe"]);
    expect(unions["code.exe"].oneToOne).toBe(3);
    expect(unions["code.exe"].itemIds).toEqual([3, 5]);
    expect(unions["code.exe"].trackOff).toBe(false);
  });

  it("ai10_任一真源读失败就整体抛_不许拿半份数据去发镜像", async () => {
    g.loadSettingRows.mockImplementation(async (options: { keyPrefix: string }) => {
      if (options.keyPrefix === "__app_override::") throw new Error("boom");
      return [{ key: "__app_item_binding::code.exe", value: '{"itemId":3}' }];
    });
    await expect(loadAppItemBindingUnions()).rejects.toThrow("boom");
  });

  /**
   * `ai10` 只钉了 override 那一侧。**1:1 那一侧**是另一半，而且更危险：1:1 独有的应用
   * （只在排行卡 / 事项栏绑过，override 里一条没有）如果"读不到 1:1 就当没有"，并集会算成
   * 空 → 补镜像发一条 `itemIds: []` → 执行端把该应用**所有**事项的 `item_app` 行删掉。
   * 变异自证：把 `loadAppItemBindings()` 的失败改成 `catch(() => ({}))` → 本条红
   * （载荷变 `[]`、`emitHostIntent` 被调用）。
   *
   * 这里用 `vi.resetModules()` + 动态 import 拿一份**新的**模块实例：`mirrorItemBindingsOnce`
   * 是"进程内只跑一次"（模块级 promise），`ai05` 已经把本文件里那份用掉了 ——
   * 不拿新实例的话这里只能测到"第二次调用什么都不做"，测不到失败路径。
   */
  it("ai11_1:1 侧读失败_补镜像一条意图都不发", async () => {
    vi.resetModules();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    g.loadSettingRows.mockImplementation(async (options: { keyPrefix: string }) => {
      if (options.keyPrefix === "__app_item_binding::") throw new Error("kv down");
      return [{ key: "__app_override::code.exe", value: '{"itemBindings":[{"itemId":3}]}' }];
    });

    const fresh = await import("./appItemBindingMirror.ts");
    await expect(fresh.loadAppItemBindingUnions()).rejects.toThrow("kv down");
    await fresh.mirrorItemBindingsOnce();

    expect(
      g.emitHostIntent,
      "半份数据等于一份冒充全集的空载荷：宁可这条不补，也不能发出去删行",
    ).not.toHaveBeenCalled();
    /* 失败要报出来（warn）且不缓存（置回 null，下次进界面再试） */
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  /**
   * [R3 口径] 「不计入」用 **OR** 合并，不是 last-wins。
   *
   * 归一后成员 exe 与父应用是**同一个统计应用**，没法只对成员生效；取 last-wins 就变成
   * "哪个键恰好排在后面哪个说了算"，每次开机 / 每次保存互相翻（用户视角："我明明标了仅观察，
   * 它又自己接管了"）。变异自证：把 OR 改成 `target.trackOff = source.trackOff` → 本条红
   * （后一行没带 `track` 就把前面的"不计入"翻回 false）。
   */
  it("ai12_trackOff 跨行用 OR_成员 exe 标过不计入就整个统计应用不计入", async () => {
    AppClassification.setAppLinks({ "code-insiders.exe": "code.exe" });
    stubSettings({
      "__app_override::": [
        /* 成员 exe 先读到、标了不计入 */
        { key: "__app_override::code-insiders.exe", value: '{"track":false,"itemBindings":[{"itemId":5}]}' },
        /* 父应用那条**没有** track 字段（= 计入），且排在后面 */
        { key: "__app_override::code.exe", value: '{"itemBindings":[{"itemId":3}]}' },
      ],
    });

    const unions = await loadAppItemBindingUnions();
    expect(Object.keys(unions), "两条 override 并进同一个统计应用").toEqual(["code.exe"]);
    expect(unions["code.exe"].itemIds).toEqual([3, 5]);
    expect(unions["code.exe"].trackOff, "后一行没带 track 不许翻掉『不计入』").toBe(true);
  });
});
