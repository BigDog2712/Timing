import { describe, expect, it } from "vitest";
import { buildTimelineRows } from "./TimelineCard";
import type { TodayItemRow } from "../hooks/useTodayItems";

/**
 * [0.13 · 1.6 重做] 行纯函数 `buildTimelineRows` 的判据。
 *
 * 新行形 = 「事项名称 - 起止时间 - 总用时」三列：
 *   · `startLabel` = 今天**第一段**的开始钟点（09:00），不是聚合窗口；
 *   · `endLabel`   = 今天**最后一段**的结束钟点；`lastEnd === null`（还有一段在跑）
 *     → V-1.6b：显示**此刻**钟点并置 `running`（止列空白会被当成数据坏了）；
 *   · 排序仍按第一段开始升序（D4），名字/时长来自 items+time_records 聚合，
 *     不是应用窗口标题（上一版用错源，这里用事项行重钉）。
 */

const NOW = new Date(2026, 10, 11, 14, 32, 0).getTime();

function row(
  itemId: number,
  name: string,
  value: number,
  firstStart: number,
  lastEnd: number | null,
  segments = 1,
): TodayItemRow {
  return { itemId, name, color: "", value, firstStart, lastEnd, segments };
}

describe("buildTimelineRows", () => {
  it("d04a_rows_follow_first_segment_start_ascending", () => {
    const rows = buildTimelineRows([
      row(1, "下午的活", 600_000, new Date(2026, 10, 11, 9, 0).getTime(), new Date(2026, 10, 11, 9, 10).getTime()),
      row(2, "早上的活", 600_000, new Date(2026, 10, 11, 1, 0).getTime(), new Date(2026, 10, 11, 1, 10).getTime()),
      row(3, "中午的活", 600_000, new Date(2026, 10, 11, 5, 0).getTime(), new Date(2026, 10, 11, 5, 10).getTime()),
    ], 6, NOW);
    expect(rows.map((item) => item.label)).toEqual(["早上的活", "中午的活", "下午的活"]);
  });

  it("d04b_empty_name_and_zero_value_rows_are_dropped", () => {
    const rows = buildTimelineRows([
      row(1, "", 600_000, 1, 2),
      row(2, "零时长", 0, 2, 3),
      row(3, "正常", 600_000, 3, 4),
    ], 6, NOW);
    expect(rows.map((item) => item.label)).toEqual(["正常"]);
  });

  it("d04c_limit_truncates_to_the_tier_capacity", () => {
    const items = Array.from({ length: 10 }, (_, index) =>
      row(index, `事项 ${index}`, 60_000, index, index + 1000));
    expect(buildTimelineRows(items, 4, NOW)).toHaveLength(4);
    expect(buildTimelineRows(items, 8, NOW)).toHaveLength(8);
  });

  it("d04d_row_keys_are_the_item_ids_so_two_rows_never_collide", () => {
    const rows = buildTimelineRows([
      row(11, "同名", 60_000, 1, 2),
      row(12, "同名", 60_000, 2, 3),
    ], 6, NOW);
    expect(rows.map((item) => item.key)).toEqual(["11", "12"]);
    expect(new Set(rows.map((item) => item.key)).size).toBe(rows.length);
  });

  it("d04e_row_says_start_end_and_total_from_the_backend_shape", () => {
    /* 09:00 开始、最后一段 10:30 结束、后端口径累计 1h 20m（三列各是各的来源） */
    const rows = buildTimelineRows([
      row(7, "写代码", 80 * 60_000, new Date(2026, 10, 11, 9, 0).getTime(), new Date(2026, 10, 11, 10, 30).getTime(), 3),
    ], 6, NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0].startLabel).toBe("09:00");
    expect(rows[0].endLabel).toBe("10:30");
    expect(rows[0].running).toBe(false);
    expect(rows[0].duration).toBe("1h 20m");
    expect(rows[0].value).toBe(80 * 60_000);
  });

  it("d04f_a_running_item_shows_the_current_clock_not_a_blank_end", () => {
    /* V-1.6b：`lastEnd === null`（还有一段在跑）→ 止列 = 此刻钟点（14:32），
       写成空白或写死一个旧时刻都是假话 */
    const rows = buildTimelineRows([
      row(5, "在跑", 600_000, new Date(2026, 10, 11, 14, 0).getTime(), null),
    ], 6, NOW);
    expect(rows[0].running).toBe(true);
    expect(rows[0].endLabel).toBe("14:32");
    expect(rows[0].startLabel).toBe("14:00");
  });

  it("d04g_saved_end_wins_over_now_even_if_now_is_later", () => {
    /* 有结束时刻的行不许显示"此刻"：`nowMs` 只给进行中的行兜底 */
    const rows = buildTimelineRows([
      row(5, "已停", 600_000, new Date(2026, 10, 11, 9, 0).getTime(), new Date(2026, 10, 11, 9, 45).getTime()),
    ], 6, NOW);
    expect(rows[0].running).toBe(false);
    expect(rows[0].endLabel).toBe("09:45");
  });
});
