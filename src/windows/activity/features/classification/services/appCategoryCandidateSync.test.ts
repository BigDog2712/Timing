/**
 * 旧页单值分类 → 新表候选集的同步判据。
 *
 * 这一层接的是「用户改了分类但切片没变」这个零报错失效：切片只读 `app_category`，
 * 而旧页写的是 KV 单值。四条判据分别钉住：删除、置首、幂等、键归一。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const g = vi.hoisted(() => ({
  list: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("../../../platform/persistence/attributionGateway.ts", () => ({
  listAppCategories: g.list,
  setAppCategory: g.set,
  removeAppCategory: g.remove,
}));

import {
  candidateKeysForOverride,
  syncCandidates,
  syncCandidatesFromOverride,
} from "./appCategoryCandidateSync.ts";
function override(category: string, enabled = true) {
  return { category, enabled };
}

beforeEach(() => {
  g.list.mockReset();
  g.set.mockReset();
  g.remove.mockReset();
  g.list.mockResolvedValue([]);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("candidateKeysForOverride", () => {
  it("有分类时是单元素数组", () => {
    expect(candidateKeysForOverride(override("game"))).toEqual(["game"]);
  });

  it("enabled=false 或 null 是空集（等于「这个应用不再有候选」）", () => {
    expect(candidateKeysForOverride(null)).toEqual([]);
    expect(candidateKeysForOverride(override("game", false))).toEqual([]);
  });

  it("空白分类不算候选（否则会往库里写一条空键）", () => {
    expect(candidateKeysForOverride(override("   "))).toEqual([]);
  });
});

describe("syncCandidates", () => {
  it("把候选集压成单条：删掉其他、目标置 priority 0", async () => {
    g.list.mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "study", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "game", priority: 10 },
    ]);
    await syncCandidates("chrome.exe", ["game"]);

    expect(g.remove.mock.calls).toEqual([["chrome.exe", "study"]]);
    /* game 原本 priority 10，要改成 0 才算「首位」—— 不改成 0 的话规则 2 仍取 study
       （它已经在上一步被删了，但若删除失败就会静默取错）。 */
    expect(g.set.mock.calls).toEqual([["chrome.exe", "game", 0]]);
  });

  it("已经一致时不写库（保存一次不该打两次跨库写）", async () => {
    g.list.mockResolvedValue([{ appKey: "chrome.exe", categoryKey: "game", priority: 0 }]);
    await syncCandidates("chrome.exe", ["game"]);
    expect(g.set).not.toHaveBeenCalled();
    expect(g.remove).not.toHaveBeenCalled();
  });

  it("目标为空时删光该应用的全部候选", async () => {
    g.list.mockResolvedValue([
      { appKey: "chrome.exe", categoryKey: "game", priority: 0 },
      { appKey: "chrome.exe", categoryKey: "study", priority: 10 },
    ]);
    await syncCandidates("chrome.exe", []);
    expect(g.remove.mock.calls).toEqual([
      ["chrome.exe", "game"],
      ["chrome.exe", "study"],
    ]);
    expect(g.set).not.toHaveBeenCalled();
  });

  it("键先归一（大写与小写 exe 不能成为两条）", async () => {
    await syncCandidates("CHROME.EXE", ["game"]);
    expect(g.list.mock.calls).toEqual([["chrome.exe"]]);
    expect(g.set.mock.calls).toEqual([["chrome.exe", "game", 0]]);
  });

  it("写失败只 warn，不把保存动作报成失败", async () => {
    g.list.mockRejectedValue(new Error("activity db locked"));
    await expect(syncCandidatesFromOverride("chrome.exe", override("game"))).resolves.toBeUndefined();
    expect(console.warn).toHaveBeenCalled();
  });
});
