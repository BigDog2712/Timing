import { describe, expect, it } from "vitest";

import { buildHistoryRangeDays } from "./historyRange.ts";
import {
  buildHistoryRangeTimeline,
  resolveRangeTimelineCellMs,
  type HistoryRangeTimelineSession,
} from "./historyRangeTimeline.ts";

/**
 * 逐日时间轴的几何判据（纯函数，不碰 DOM）。
 *
 * 这一层最容易错的三件事，全部不会报错、只会安静地画歪：
 *   1. **分母写成"可见窗口"**：今天只看到此刻，分母一变，上午的块就被横向拉满；
 *   2. **跨日会话不切**：23:50 开始的那条在两天里各画一半才叫按墙钟分摊，
 *      不切的话它会整条落在其中一天，另一天凭空少一段；
 *   3. **相邻同应用不合并**：库里一天几百条会话，一格格画出来是等距虚线，
 *      看不出"这段连续工作"，DOM 还会炸。
 */
const HOUR = 60 * 60 * 1000;
const MINUTE = 60 * 1000;

const DAY_START = new Date(2026, 10, 10, 0, 0, 0, 0).getTime();
const AT = (hour: number, minute = 0) => DAY_START + hour * HOUR + minute * MINUTE;

const code = (startMs: number, endMs: number): HistoryRangeTimelineSession => ({
  exeName: "Code.exe",
  appName: "VS Code",
  startMs,
  endMs,
});

const chrome = (startMs: number, endMs: number): HistoryRangeTimelineSession => ({
  exeName: "chrome.exe",
  appName: "Chrome",
  startMs,
  endMs,
});

describe("resolveRangeTimelineCellMs · 格宽随跨度放大", () => {
  it("t01_two_days_stay_fine_and_thirty_days_go_coarse", () => {
    /* 一天看得细（5 分钟），一个月看得粗（15 分钟）。这条同时是 DOM 上限：
       每天最多 288 / 144 / 96 块，与库里有多少条会话无关。 */
    expect(resolveRangeTimelineCellMs(1)).toBe(5 * MINUTE);
    expect(resolveRangeTimelineCellMs(2)).toBe(5 * MINUTE);
    expect(resolveRangeTimelineCellMs(7)).toBe(10 * MINUTE);
    expect(resolveRangeTimelineCellMs(30)).toBe(15 * MINUTE);
  });
});

describe("buildHistoryRangeTimeline · 一天一条带", () => {
  const days = buildHistoryRangeDays("2026-11-10", "2026-11-10", DAY_START + 24 * HOUR);

  it("t02_block_covers_the_quantized_window_and_uses_the_full_day_as_denominator", () => {
    const lanes = buildHistoryRangeTimeline(days, [code(AT(9, 2), AT(9, 52))]);
    expect(lanes).toHaveLength(1);
    const blocks = lanes[0].blocks;
    expect(blocks).toHaveLength(1);
    /* 格宽 5 分钟：起点向下取格（09:02 → 09:00），终点向上取格（09:52 → 09:55） */
    expect(blocks[0].startMs).toBe(AT(9));
    expect(blocks[0].endMs).toBe(AT(9, 55));
    /* 分母是**完整一天**，不是"可见窗口"——今天只看到此刻也不会被拉满 */
    expect(blocks[0].leftRatio).toBeCloseTo(9 / 24, 6);
    expect(blocks[0].widthRatio).toBeCloseTo(55 / 1440, 6);
    expect(lanes[0].spanMs).toBe(24 * HOUR);
  });

  it("t03_adjacent_cells_of_one_app_merge_into_a_single_block", () => {
    /* 09:00–09:30 连续 6 个格：必须合并成一块，否则一天几百条会话就是几百个碎块 */
    const lanes = buildHistoryRangeTimeline(days, [code(AT(9), AT(9, 30))]);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].startMs).toBe(AT(9));
    expect(lanes[0].blocks[0].endMs).toBe(AT(9, 30));
  });

  it("t04_two_apps_in_the_same_cell_keep_the_longer_one", () => {
    /* 同一格内 Code 3 分钟、Chrome 2 分钟：格主是 Code（分格取主导，不是叠加） */
    const lanes = buildHistoryRangeTimeline(days, [
      code(AT(10), AT(10, 3)),
      chrome(AT(10, 3), AT(10, 5)),
    ]);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].key).toBe("code.exe");
    expect(lanes[0].blocks[0].label).toBe("VS Code");
  });

  it("t05_different_apps_in_different_cells_stay_separate", () => {
    const lanes = buildHistoryRangeTimeline(days, [
      code(AT(10), AT(10, 10)),
      chrome(AT(11), AT(11, 10)),
    ]);
    expect(lanes[0].blocks.map((block) => block.key)).toEqual(["code.exe", "chrome.exe"]);
  });

  it("t06_empty_day_is_still_a_lane", () => {
    /* 空日也要出现在带子里：用户要看到的是"这天为什么是空的"，不是这天凭空消失 */
    const lanes = buildHistoryRangeTimeline(days, []);
    expect(lanes).toHaveLength(1);
    expect(lanes[0].dateKey).toBe("2026-11-10");
    expect(lanes[0].blocks).toHaveLength(0);
  });

  it("t07_tie_breaks_on_key_so_the_picture_does_not_flicker", () => {
    /* 同长时按键名定序：同一份数据必须每次画得一模一样，否则每次刷新都在抖 */
    const lanes = buildHistoryRangeTimeline(days, [
      chrome(AT(12), AT(12, 2)),
      code(AT(12, 2), AT(12, 4)),
    ]);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].key).toBe("chrome.exe");
  });
});

describe("buildHistoryRangeTimeline · 跨日与此刻", () => {
  it("t08_session_across_midnight_is_split_by_wall_clock", () => {
    /* 23:50 → 次日 00:20：10 分钟落前一天，20 分钟落后一天（与四格摘要同一口径） */
    const days = buildHistoryRangeDays("2026-11-09", "2026-11-10", AT(24));
    const lanes = buildHistoryRangeTimeline(days, [
      code(DAY_START - 10 * MINUTE, DAY_START + 20 * MINUTE),
    ]);
    expect(lanes).toHaveLength(2);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].endMs).toBe(DAY_START);
    expect(lanes[1].blocks).toHaveLength(1);
    expect(lanes[1].blocks[0].startMs).toBe(DAY_START);
    expect(lanes[1].blocks[0].endMs).toBe(AT(0, 20));
  });

  it("t09_today_is_trimmed_to_now_but_keeps_the_full_day_as_denominator", () => {
    /* 看今天只到此刻：晚于此刻的会话不许画，且分母仍是整天（否则上午会被拉满） */
    const days = buildHistoryRangeDays("2026-11-10", "2026-11-10", AT(15));
    const lanes = buildHistoryRangeTimeline(days, [
      code(AT(9), AT(10)),
      chrome(AT(20), AT(22)),
    ]);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].endMs).toBe(AT(10));
    expect(lanes[0].spanMs).toBe(24 * HOUR);
    expect(lanes[0].viewEndMs).toBe(AT(15));
  });

  it("t10_session_starting_before_the_range_is_clipped_at_the_left_edge", () => {
    /* 区间从 11-10 开始，会话从 11-09 23:00 就在：只能从 00:00 画起 */
    const days = buildHistoryRangeDays("2026-11-10", "2026-11-10", AT(24));
    const lanes = buildHistoryRangeTimeline(days, [code(AT(-1), AT(1))]);
    expect(lanes[0].blocks).toHaveLength(1);
    expect(lanes[0].blocks[0].startMs).toBe(DAY_START);
    expect(lanes[0].blocks[0].leftRatio).toBe(0);
    expect(lanes[0].blocks[0].endMs).toBe(AT(1));
  });
});
