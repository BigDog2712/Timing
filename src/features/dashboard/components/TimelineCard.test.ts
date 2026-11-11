import { describe, expect, it } from "vitest";
import { buildTimelineRows } from "./TimelineCard";
import type { TodayItemRow } from "../hooks/useTodayItems";

/**
 * [P3 修正 · 0.12.1] D4 判据：**事项**按时序升序，名字/时长来自 items+time_records 的聚合，
 * 不是应用窗口标题（上一版用错源，这里用事项行重钉）。
 */
function row(itemId: number, name: string, value: number, firstStart: number, segments = 1): TodayItemRow {
  return { itemId, name, color: "", value, firstStart, segments };
}

describe("buildTimelineRows", () => {
  it("d04a_rows_follow_first_segment_start_ascending", () => {
    const rows = buildTimelineRows([
      row(1, "下午的活", 600_000, Date.UTC(2026, 10, 11, 9, 0)),
      row(2, "早上的活", 600_000, Date.UTC(2026, 10, 11, 1, 0)),
      row(3, "中午的活", 600_000, Date.UTC(2026, 10, 11, 5, 0)),
    ], 6);
    expect(rows.map((item) => item.label)).toEqual(["早上的活", "中午的活", "下午的活"]);
  });

  it("d04b_empty_name_and_zero_value_rows_are_dropped", () => {
    const rows = buildTimelineRows([
      row(1, "", 600_000, 1),
      row(2, "零时长", 0, 2),
      row(3, "正常", 600_000, 3),
    ], 6);
    expect(rows.map((item) => item.label)).toEqual(["正常"]);
  });

  it("d04c_limit_truncates_to_the_tier_capacity", () => {
    const items = Array.from({ length: 10 }, (_, index) => row(index, `事项 ${index}`, 60_000, index));
    expect(buildTimelineRows(items, 4)).toHaveLength(4);
    expect(buildTimelineRows(items, 8)).toHaveLength(8);
  });

  it("d04d_row_keys_are_the_item_ids_so_two_rows_never_collide", () => {
    const rows = buildTimelineRows([row(11, "同名", 60_000, 1), row(12, "同名", 60_000, 2)], 6);
    expect(rows.map((item) => item.key)).toEqual(["11", "12"]);
    expect(new Set(rows.map((item) => item.key)).size).toBe(rows.length);
  });
});
