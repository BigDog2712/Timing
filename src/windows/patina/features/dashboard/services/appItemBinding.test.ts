import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 「应用 → 事项」绑定 KV 的**读写往返**（0.12.1 双击应用行那一轮）。
 *
 * 为什么这组要单独钉：这条链路横跨三层（前端拼键 → Rust 前缀白名单 → 设置表 KV），
 * 任何一层错位都是**静默的**——
 *   · 前端拼错键 → Rust 白名单拒绝（`invalid key`），用户看到「保存失败」但没人说得清为什么；
 *   · 值写成 `{"itemId":null}` 而不是删行 → 「未绑定」有两种表示法，读侧要同时认两种；
 *   · 读侧把未知前缀的行也算进来 → 把别人的设置当成绑定显示在行上。
 * 所以这里既钉往返（写进去能读回来），也钉**清除**与**脏数据降级**。
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
  APP_ITEM_BINDING_KEY_PREFIX,
  buildAppItemBindingKey,
  clearAppItemBinding,
  listAppItemBindingOptions,
  loadAppItemBindingFor,
  loadAppItemBindings,
  mirrorItemBindingsOnce,
  parseAppItemBindingRows,
  parseAppItemBindingValue,
  saveAppItemBinding,
  serializeAppItemBindingValue,
} from "./appItemBinding.ts";
import { AppClassification } from "../../../shared/classification/appClassification.ts";

beforeEach(() => {
  AppClassification.setAppLinks({});
  g.commit.mockReset();
  g.loadSettingRows.mockReset();
  /* [R1] 写一条绑定现在要多读两份真源（1:1 上一值 + override）：默认"都没数据" */
  g.loadSettingRows.mockResolvedValue([]);
  g.listTimingItems.mockReset();
  g.emitHostIntent.mockReset();
  g.emitHostIntent.mockResolvedValue(true);
});

/**
 * [0.13 fix] 镜像宿主 `item_app`（用户报「启动了燕云但没开始计时」）。
 *
 * 这条链路断掉的症状是**零报错**：界面上"已绑定"的标记一切正常（它读的是 KV），
 * 只有药丸那边永远查不到绑定 → 永远不接管。所以这里钉住"保存之后必须发一条镜像意图"，
 * 以及 `appKey` 的口径（`normalizeAppKey`，与 `sessions.app_key` 同一个函数 ——
 * 用错成"统计应用"口径会绑到一条永远读不出来的键上）。
 */
describe("镜像宿主 item_app（[0.13 fix]）", () => {
  it("绑定后发一条 sync_app_item_bindings，appKey 走 normalizeAppKey 口径", async () => {
    g.commit.mockResolvedValue(undefined);
    await saveAppItemBinding("Code.EXE", 7);

    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "code.exe",
      itemIds: [7],
    });
  });

  it("清除绑定 = 空全集（宿主侧据此把该应用的行全解绑）", async () => {
    g.commit.mockResolvedValue(undefined);
    await saveAppItemBinding("chrome.exe", null);

    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "chrome.exe",
      itemIds: [],
    });
  });

  it("配置写失败就不发镜像（否则宿主绑上了、界面却报保存失败）", async () => {
    g.commit.mockRejectedValue(new Error("db locked"));
    await expect(saveAppItemBinding("chrome.exe", 7)).rejects.toThrow("db locked");
    expect(g.emitHostIntent).not.toHaveBeenCalled();
  });

  it("空 exe 名不发镜像", async () => {
    g.commit.mockResolvedValue(undefined);
    await saveAppItemBinding("   ", 7);
    expect(g.emitHostIntent).not.toHaveBeenCalled();
  });
});

/**
 * 存量绑定的补镜像（[0.13 fix]）：本轮之前**没有任何代码**往宿主 `item_app` 写过行，
 * 所以老用户的绑定只存在于 KV 里。不补的话，修完之后老用户仍然「界面显示已绑定、
 * 切过去不计时」—— 与 bug 本身同一个症状，而且更难排查。
 *
 * 一条用例走完三段（模块级只跑一次，所以不能拆成三条互相依赖的用例）：
 *   ① 发失败**不缓存** → 下次进界面还能重试；
 *   ② 重试成功 → 每条 1:1 绑定发一次全集（`itemIds: [itemId]`）；
 *   ③ 第三次 → 进程内不再发（不重复打扰宿主）。
 */
describe("存量绑定补镜像（[0.13 fix]）", () => {
  it("ai05_失败可重试_成功之后进程内不再发", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    g.emitHostIntent.mockRejectedValueOnce(new Error("pill not ready"));
    await mirrorItemBindingsOnce({ "yanyun.exe": 12 });
    expect(g.emitHostIntent).toHaveBeenCalledTimes(1);

    g.emitHostIntent.mockClear();
    await mirrorItemBindingsOnce({ "yanyun.exe": 12, "code.exe": 7 });
    expect(g.emitHostIntent).toHaveBeenCalledTimes(2);
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "yanyun.exe",
      itemIds: [12],
    });
    expect(g.emitHostIntent).toHaveBeenCalledWith({
      action: "sync_app_item_bindings",
      appKey: "code.exe",
      itemIds: [7],
    });

    g.emitHostIntent.mockClear();
    await mirrorItemBindingsOnce({ "yanyun.exe": 12 });
    expect(g.emitHostIntent).not.toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe("键与值的形状", () => {
  it("键 = 前缀 + 归一后 exe 名（trim + 小写，与写侧同一个函数）", () => {
    expect(APP_ITEM_BINDING_KEY_PREFIX).toBe("__app_item_binding::");
    expect(buildAppItemBindingKey("chrome.exe")).toBe("__app_item_binding::chrome.exe");
    expect(buildAppItemBindingKey("  code.exe ")).toBe("__app_item_binding::code.exe");
    /* 归一是**硬要求**（0.12.1 S1 的另一半）：KV 里只能留 `code.exe` 一种键。
       读侧归一而写侧不归一，行标记照样时灵时不灵 —— 两边必须是同一个函数。 */
    expect(buildAppItemBindingKey("Code.exe")).toBe("__app_item_binding::code.exe");
    expect(buildAppItemBindingKey("   ")).toBeNull();
  });

  it("值 = {\"itemId\":N}；只有 null 表示清除，非法 id 抛错而不是冒充清除", () => {
    /* 0.12.1 G3：旧语义里非法 id 也返回 `null`，于是任何一处把 `0` 当成「未选择」
       传进来就会走 Rust 的删除分支、**静默删掉**用户已有绑定。现在 `null` 只表示清除，
       非法值必须让调用方看见（`saveAppItemBinding` 上抛 → 弹层 `onError`）。
       注意**解析侧**的降级不跟着改：读到坏值仍然当「未绑定」，只是不主张去清库。 */
    expect(serializeAppItemBindingValue(12)).toBe('{"itemId":12}');
    expect(serializeAppItemBindingValue(null), "null 才是清除").toBeNull();
    expect(() => serializeAppItemBindingValue(0)).toThrow(RangeError);
    expect(() => serializeAppItemBindingValue(-3)).toThrow(RangeError);
    expect(() => serializeAppItemBindingValue(1.5)).toThrow(RangeError);
    expect(() => serializeAppItemBindingValue(Number.NaN)).toThrow(RangeError);
  });

  it("解析对坏 JSON / 缺字段 / 非正整数一律降级为「未绑定」", () => {
    expect(parseAppItemBindingValue('{"itemId":12}')).toBe(12);
    expect(parseAppItemBindingValue('{"itemId":"12"}')).toBeNull();
    expect(parseAppItemBindingValue('{"itemId":null}')).toBeNull();
    expect(parseAppItemBindingValue('{"itemId":0}')).toBeNull();
    expect(parseAppItemBindingValue("not json")).toBeNull();
    expect(parseAppItemBindingValue("")).toBeNull();
    expect(parseAppItemBindingValue(null)).toBeNull();
  });

  it("往返：写进去的值能原样读回来", () => {
    expect(parseAppItemBindingValue(serializeAppItemBindingValue(42))).toBe(42);
    expect(parseAppItemBindingValue(serializeAppItemBindingValue(null))).toBeNull();
  });
});

describe("写路径（复用 cmd_commit_classification_settings）", () => {
  it("设置绑定 = 一条 upsert；清除 = 同一个键、value 传 null", async () => {
    await saveAppItemBinding("chrome.exe", 7);
    expect(g.commit).toHaveBeenLastCalledWith([
      { key: "__app_item_binding::chrome.exe", value: '{"itemId":7}' },
    ]);

    await saveAppItemBinding("chrome.exe", null);
    expect(g.commit).toHaveBeenLastCalledWith([
      { key: "__app_item_binding::chrome.exe", value: null },
    ]);
  });

  it("空 exe 名不发请求（脏数据不该产生一条命令）", async () => {
    await saveAppItemBinding("  ", 7);
    expect(g.commit).not.toHaveBeenCalled();
  });

  it("非法 itemId 不产生写命令（不能悄悄变成删除）", async () => {
    await expect(saveAppItemBinding("chrome.exe", 0)).rejects.toThrow(RangeError);
    expect(g.commit, "非法值却发了写命令（Rust 侧会把它当删除）").not.toHaveBeenCalled();
  });
});

describe("读路径（一次前缀扫描）", () => {
  it("只认本前缀的行，别的键一概忽略", () => {
    expect(parseAppItemBindingRows([
      { key: "__app_item_binding::chrome.exe", value: '{"itemId":3}' },
      { key: "__app_override::chrome.exe", value: '{"category":"office"}' },
      /* 这一条是**前缀过滤唯一的证据**：值的形状与本表的绑定完全一样（`{"itemId":N}`），
         只剩「键前缀不对」这一个理由能把它挡在外面。少了它，即使读侧不做前缀过滤，
         上面那条 `{"category":"office"}` 也会因为 itemId 缺失被丢掉 —— 实测过（变异自证 M3）。 */
      { key: "__app_override::leak.exe", value: '{"itemId":99}' },
      { key: "__category_color_override::work", value: '{"itemId":98}' },
      { key: "__app_item_binding::broken.exe", value: "garbage" },
      { key: "__app_item_binding::", value: '{"itemId":9}' },
    ])).toEqual({ "chrome.exe": 3 });
  });

  it("键在读侧归一：历史行留着原始大小写也查得到（0.12.1 S1）", () => {
    /* `AppStat.exeName` 会保留记录时的原始大小写（`Code.exe`），
       而 KV 的键是归一后的 `code.exe`；反过来，库里万一留着 `Code.exe` 的旧行，也要认。 */
    expect(parseAppItemBindingRows([
      { key: "__app_item_binding::Code.exe", value: '{"itemId":3}' },
    ])).toEqual({ "code.exe": 3 });
  });

  it("归一后撞成一条：后出现的覆盖先出现的，map 里不留大小写两份", () => {
    expect(parseAppItemBindingRows([
      { key: "__app_item_binding::Code.exe", value: '{"itemId":3}' },
      { key: "__app_item_binding::code.exe", value: '{"itemId":5}' },
    ])).toEqual({ "code.exe": 5 });
  });

  it("键归一包含应用关联（__app_link::）：成员与父应用共用一条绑定", () => {
    /* 这一条钉的是「用 `resolveStatisticalApp` 而不是 `resolveCanonicalExecutable`」：
       换成后者，`code-insiders.exe` 会去查自己的键、查不到父应用那条绑定。
       判据来源是 `resolveAppItemBindingExe` 的注释，不是实现细节。 */
    AppClassification.setAppLinks({ "code-insiders.exe": "code.exe" });
    expect(parseAppItemBindingRows([
      { key: "__app_item_binding::code.exe", value: '{"itemId":5}' },
    ])[AppClassification.resolveStatisticalApp("code-insiders.exe")]).toBe(5);
    /* 写侧同一个函数 → 成员写下去也落在父应用的键上。 */
    expect(buildAppItemBindingKey("code-insiders.exe")).toBe("__app_item_binding::code.exe");
  });

  it("整表读一次，透传前缀过滤", async () => {
    g.loadSettingRows.mockResolvedValue([
      { key: "__app_item_binding::a.exe", value: '{"itemId":1}' },
      { key: "__app_item_binding::b.exe", value: '{"itemId":2}' },
    ]);
    await expect(loadAppItemBindings()).resolves.toEqual({ "a.exe": 1, "b.exe": 2 });
    expect(g.loadSettingRows).toHaveBeenCalledTimes(1);
    expect(g.loadSettingRows).toHaveBeenCalledWith({ keyPrefix: "__app_item_binding::" });
  });

  it("候选清单来自 list_items（全部未归档事项），不是「今日有记录的事项」", async () => {
    g.listTimingItems.mockResolvedValue([
      { id: 1, name: "写代码", color: "#123456", isSystem: false },
      { id: 2, name: "开会", color: "", isSystem: false },
    ]);
    await expect(listAppItemBindingOptions()).resolves.toEqual([
      { id: 1, name: "写代码", color: "#123456" },
      { id: 2, name: "开会", color: "" },
    ]);
  });
});

/**
 * [0.13 fix · P0-3] 单个应用的 1:1 读，与「**只**清 KV」的清除（守"解绑了、重启又被补回来"）：
 *   · 读必须**抛错**而不是降级成"没有绑定"（降级＝下一次保存把真绑定当"用户取消"删掉）；
 *   · 清除必须**只**动 KV、不发 `itemIds: []`（本场景恰恰是"全集里还留着别的事项"）。
 * 变异自证：换成 `saveAppItemBinding(exe, null)` → ai08 红；把 `throw` 吞成 `return null` → ai07 红。
 */
describe("1:1 绑定的单应用读 / 只清 KV（[0.13 fix · P0-3]）", () => {
  it("ai06_按完整键前缀读该应用的 1:1 绑定_没有时是 null", async () => {
    g.loadSettingRows.mockResolvedValue([
      { key: "__app_item_binding::code.exe", value: '{"itemId":5}' },
      { key: "__app_item_binding::other.exe", value: '{"itemId":9}' },
    ]);
    await expect(loadAppItemBindingFor("Code.exe")).resolves.toBe(5);
    /* 只读这一个应用：前缀就是**完整键**，别把全表拉回来 */
    expect(g.loadSettingRows).toHaveBeenCalledWith({ keyPrefix: "__app_item_binding::code.exe" });

    g.loadSettingRows.mockResolvedValue([]);
    await expect(loadAppItemBindingFor("code.exe")).resolves.toBeNull();
  });

  it("ai07_读失败往上抛_不许降级成「没有绑定」", async () => {
    g.loadSettingRows.mockRejectedValue(new Error("boom"));
    await expect(loadAppItemBindingFor("code.exe")).rejects.toThrow("boom");
  });

  it("ai08_清除 1:1 只写 KV_不发镜像", async () => {
    g.commit.mockResolvedValue(undefined);
    await clearAppItemBinding("Code.exe");
    expect(g.commit).toHaveBeenCalledWith([{ key: "__app_item_binding::code.exe", value: null }]);
    expect(g.emitHostIntent).not.toHaveBeenCalled();
  });
});
