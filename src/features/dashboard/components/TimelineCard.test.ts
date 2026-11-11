import { describe, expect, it } from "vitest";
import { buildTimelineRows } from "./TimelineCard";
import type { CompiledSession } from "../../../shared/lib/sessionReadCompiler";

/**
 * [P3 · 0.12.1] D4 的判据：卡内顺序 = 按 `startedAt` 升序，且不把无名字/零时长的会话画成空行。
 * 把排序改成降序、或把空名字过滤删掉，这两条都会红。
 */
function session(startTime: number, displayTitle: string, duration: number, displayName = "VS Code"): CompiledSession {
  return {
    exeName: "code.exe",
    displayName,
    displayTitle,
    displayNameRank: 0,
    startTime,
    endTime: startTime + duration,
    duration,
    appKey: "code.exe",
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

describe("buildTimelineRows", () => {
  it("d04a_rows_are_in_ascending_start_order", () => {
    const rows = buildTimelineRows([
      session(Date.UTC(2026, 10, 11, 9, 0), "下午的活", 600_000),
      session(Date.UTC(2026, 10, 11, 1, 0), "早上的活", 600_000),
      session(Date.UTC(2026, 10, 11, 5, 0), "中午的活", 600_000),
    ], 6);
    expect(rows.map((row) => row.label)).toEqual(["早上的活", "中午的活", "下午的活"]);
  });

  it("d04b_zero_duration_and_fully_nameless_sessions_are_dropped", () => {
    const rows = buildTimelineRows([
      /* 只有应用名没有窗口标题 → 回落应用名（与 buildTopItems 同一口径，不算空行） */
      session(Date.UTC(2026, 10, 11, 1, 0), "", 600_000),
      session(Date.UTC(2026, 10, 11, 2, 0), "零时长", 0),
      /* 连应用名都没有 → 不画 */
      session(Date.UTC(2026, 10, 11, 2, 30), "", 600_000, ""),
      session(Date.UTC(2026, 10, 11, 3, 0), "正常", 600_000),
    ], 6);
    expect(rows.map((row) => row.label)).toEqual(["VS Code", "正常"]);
  });

  it("d04c_limit_truncates_to_the_tier_capacity", () => {
    const sessions = Array.from({ length: 10 }, (_, index) =>
      session(Date.UTC(2026, 10, 11, index, 0), `第 ${index} 段`, 60_000));
    expect(buildTimelineRows(sessions, 4)).toHaveLength(4);
    expect(buildTimelineRows(sessions, 8)).toHaveLength(8);
  });

  it("d04d_row_keys_are_unique_even_for_identical_titles", () => {
    const rows = buildTimelineRows([
      session(Date.UTC(2026, 10, 11, 1, 0), "同名", 60_000),
      session(Date.UTC(2026, 10, 11, 1, 0), "同名", 60_000),
    ], 6);
    expect(new Set(rows.map((row) => row.key)).size).toBe(rows.length);
  });
});
