/**
 * `filterAndSortCandidates` 的排序口径（[0.13] 主人口径：**未分类应用默认沉底**）。
 *
 * 为什么值得一条用例：排序是"看起来没问题"的那类代码 —— 混排（按名字排）在只有几条
 * 应用时几乎看不出毛病，等到几十条应用时用户才会发现"我刚分完类的那条还在中间"。
 * 这里把两级键钉死：
 *   ① 已分类在前、未分类（`other`）在后；
 *   ② 两组**组内**仍按显示名（数字感知、忽略大小写）排，并受搜索过滤影响。
 *
 * 纯函数、无 React、无网关 —— 直接喂候选就行。
 */
import { describe, expect, it } from "vitest";

import { filterAndSortCandidates } from "./classificationCandidateFiltering";
import type { CandidateFilter, ObservedAppCandidate } from "../types.ts";
import type { UserAssignableAppCategory } from "../../../shared/classification/categoryTokens.ts";

function candidate(exeName: string, appName: string): ObservedAppCandidate {
  return { exeName, appName, totalDuration: 0, lastSeenMs: 0 };
}

function run(
  candidates: ObservedAppCandidate[],
  categories: Record<string, UserAssignableAppCategory>,
  filter: CandidateFilter = "all",
  searchQuery = "",
): string[] {
  return filterAndSortCandidates({
    candidates,
    filter,
    searchQuery,
    resolveMappedCategory: (item) => categories[item.exeName] ?? "other",
    resolveEffectiveDisplayName: (item) => item.appName,
    resolveCategoryLabel: (category) => category,
    locale: "zh-CN",
  }).map((item) => item.appName);
}

describe("filterAndSortCandidates · 未分类沉底", () => {
  const candidates = [
    candidate("zebra.exe", "Zebra"),
    candidate("alpha.exe", "Alpha"),
    candidate("beta.exe", "Beta"),
    candidate("gamma.exe", "Gamma"),
  ];
  const categories: Record<string, UserAssignableAppCategory> = {
    "beta.exe": "development",
    "gamma.exe": "office",
  };

  it("fc01_已分类在前_未分类沉底_两组组内按名字排", () => {
    /* 期望：已分类组 Beta(study) / Gamma(work) 按名字是 Beta<Gamma；未分类组 Alpha / Zebra */
    expect(run(candidates, categories)).toEqual(["Beta", "Gamma", "Alpha", "Zebra"]);
  });

  it("fc02_搜索过滤之后沉底规则不变", () => {
    /* 搜索串会同时匹配 exe 名与分类名，所以在现有集合上搜任一个字母都会命中 `.exe`
       → 这里单独给一对"只共享搜索词"的候选：Nova 已分类、Note 未分类，搜 "no" 两条都中 */
    const pair = [candidate("note.exe", "Note"), candidate("nova.exe", "Nova")];
    expect(run(pair, { "nova.exe": "development" }, "all", "no")).toEqual(["Nova", "Note"]);
  });

  it("fc03_只看未分类时一组内仍按名字排_沉底那一级恒等", () => {
    expect(run(candidates, categories, "other")).toEqual(["Alpha", "Zebra"]);
  });

  it("fc04_全部未分类时退化成纯名字序_不能因为沉底把顺序打乱", () => {
    expect(run(candidates, {})).toEqual(["Alpha", "Beta", "Gamma", "Zebra"]);
  });

  it("fc05_已分类组的名字排在后面也不影响它在前_沉底优先于字典序", () => {
    /* Zebra 是已分类（study）、Alpha 是未分类：Zebra 必须排在 Alpha 之前 */
    expect(run(candidates, { "zebra.exe": "development" })).toEqual(["Zebra", "Alpha", "Beta", "Gamma"]);
  });
});
