import { describe, expect, it } from "vitest";
import { buildFocusDistribution, isFocusDimension } from "./focusDimension";
import type { AppStat } from "../../../shared/types/app";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler";
import { buildCategoryDistribution, buildTopApplications } from "./dashboardFormatting";

/**
 * [P2 · 0.12.1] C1 的判据：三个维度是**同一份数据换分组**，不是三份数据。
 *
 * 三种口径的总量必须自洽：
 *   ① 分类 Σ === 应用 Σ（同一批 AppStat 的两种分组，必须**完全**相等）
 *   ② 标题 Σ ≤ 分类 Σ（无标题 / 零时长会话不进标题维度 —— 那个维度里没有这一行，不是丢数据）
 * 把 `buildFocusDistribution` 的某个分支改成返回空数组，这两条都会红。
 */
const stats: AppStat[] = [
  { exeName: "code.exe", appName: "VS Code", totalDuration: 3_600_000 } as AppStat,
  { exeName: "chrome.exe", appName: "Chrome", totalDuration: 2_400_000 } as AppStat,
];

function session(exeName: string, displayTitle: string, duration: number, startTime = 0): CompiledSession {
  return {
    exeName,
    displayName: exeName,
    displayTitle,
    displayNameRank: 0,
    startTime,
    endTime: startTime + duration,
    duration,
    appKey: exeName,
    continuityGroupStartTime: startTime,
    mergedCount: 1,
    titleSamples: [displayTitle],
    titleSampleDetails: [],
    sourceIds: [],
    diagnosticCodes: [],
    suspiciousDuration: 0,
    isLive: false,
  } as unknown as CompiledSession;
}

const sessions = [
  session("code.exe", "main.ts — timing", 2_400_000),
  session("code.exe", "main.ts — timing", 1_200_000, 2_400_000),
  session("chrome.exe", "文档 — Google Chrome", 1_800_000),
  session("chrome.exe", "", 600_000),
];

describe("buildFocusDistribution", () => {
  const categories = buildCategoryDistribution(stats);
  const applications = buildTopApplications(stats);
  const source = { categories, applications, sessions };

  it("c01_category_and_app_totals_are_the_same_number", () => {
    const byCategory = buildFocusDistribution("category", source);
    const byApp = buildFocusDistribution("app", source);
    expect(byCategory.total).toBe(6_000_000);
    expect(byApp.total).toBe(byCategory.total);
  });

  it("c01b_title_total_equals_measured_total_when_every_session_has_a_title", () => {
    const byCategory = buildFocusDistribution("category", source);
    const byTitle = buildFocusDistribution("title", source);
    /* 每条会话都有标题（或回落成应用名）时，三个维度必须同额 —— 这就是 C1 说的「同一份数据」。 */
    expect(byTitle.total).toBe(byCategory.total);
    expect(byTitle.slices.map((slice) => slice.key)).toEqual([
      "main.ts — timing",
      "文档 — Google Chrome",
      /* 空 displayTitle 回落到 displayName，这是 buildTopItems 的既有口径，不是丢数据 */
      "chrome.exe",
    ]);
  });

  it("c01b2_session_without_any_name_is_dropped_not_counted_as_zero", () => {
    const nameless = { exeName: "unknown.exe", displayName: "", displayTitle: "" } as unknown as CompiledSession;
    const withNameless = buildFocusDistribution("title", {
      categories,
      applications,
      sessions: [...sessions, { ...nameless, duration: 900_000, startTime: 9_000_000 }],
    });
    /* 无名字的会话不进标题维度：总量不涨，也不会出现一个空字符串的切片。 */
    expect(withNameless.total).toBe(buildFocusDistribution("title", source).total);
    expect(withNameless.slices.every((slice) => slice.key.trim().length > 0)).toBe(true);
  });

  it("c01c_slices_are_sorted_by_value_desc_and_single_bucket_per_key", () => {
    const byTitle = buildFocusDistribution("title", source);
    const values = byTitle.slices.map((slice) => slice.value);
    expect([...values].sort((a, b) => b - a)).toEqual(values);
    expect(new Set(byTitle.slices.map((slice) => slice.key)).size).toBe(byTitle.slices.length);
  });

  it("c01d_category_slices_keep_their_category_for_i18n_and_anonymous_texture", () => {
    const byCategory = buildFocusDistribution("category", source);
    expect(byCategory.slices.every((slice) => typeof slice.category === "string")).toBe(true);
    /* 另外两个维度不该伪造 category：伪造会把「匿名活动」的纹理画到普通应用上。 */
    const byApp = buildFocusDistribution("app", source);
    expect(byApp.slices.every((slice) => slice.category === undefined)).toBe(true);
  });

  it("c02_isFocusDimension_only_accepts_the_three_known_values", () => {
    expect(isFocusDimension("category")).toBe(true);
    expect(isFocusDimension("app")).toBe(true);
    expect(isFocusDimension("title")).toBe(true);
    expect(isFocusDimension("items")).toBe(false);
    expect(isFocusDimension(null)).toBe(false);
  });
});
