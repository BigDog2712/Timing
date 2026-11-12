import { describe, expect, it } from "vitest";

import { buildHistoryRangeDays } from "./historyRange.ts";
import { buildHistoryRangeAggregate } from "./historyRangeAggregate.ts";

/**
 * 区间聚合的四条口径各自钉一遍。
 *
 * 这一层的错**在界面上看不出来**：数字都是一个"看起来合理的时长"，
 * 只有把边界案例（跨日、区间外、未完成）单独喂进去才能分清真错与"就是这个数"。
 */
const D1 = new Date(2026, 10, 10, 0, 0, 0, 0).getTime();
const D2 = new Date(2026, 10, 11, 0, 0, 0, 0).getTime();
const D3 = new Date(2026, 10, 12, 0, 0, 0, 0).getTime();
const HOUR = 60 * 60 * 1000;

/** 11-10 00:00 ~ 11-11 24:00（两天整），区间右端 = D3 */
const DAYS = buildHistoryRangeDays("2026-11-10", "2026-11-11", D3);

const baseInput = {
  days: DAYS,
  sessions: [],
  records: [],
  items: [],
  notes: [],
  todos: [],
  unnamedItemLabel: "未命名计时",
};

describe("buildHistoryRangeAggregate · 应用按墙钟分摊", () => {
  it("a01_cross_day_session_is_split_at_midnight", () => {
    /* 11-10 23:00 → 11-11 01:00：两天各 1 小时。
       变异：把 distributeSession 改成"整段记在起始日" → 第一天 2h、第二天 0 → 本条红 */
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      sessions: [{ exeName: "code.exe", appName: "VS Code", startMs: D2 - HOUR, endMs: D2 + HOUR }],
    });
    expect(aggregate.days[0].appMs).toBe(HOUR);
    expect(aggregate.days[1].appMs).toBe(HOUR);
    expect(aggregate.activityMs).toBe(2 * HOUR);
    expect(aggregate.apps).toHaveLength(1);
    expect(aggregate.apps[0].share).toBeCloseTo(1, 5);
  });

  it("a02_session_outside_the_range_is_ignored", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      sessions: [
        { exeName: "a.exe", appName: "A", startMs: D1 - 5 * HOUR, endMs: D1 - 4 * HOUR },
        { exeName: "a.exe", appName: "A", startMs: D1 + HOUR, endMs: D1 + 2 * HOUR },
      ],
    });
    expect(aggregate.activityMs).toBe(HOUR);
    expect(aggregate.days[0].appMs).toBe(HOUR);
  });

  it("a03_same_exe_merges_and_share_is_over_the_total", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      sessions: [
        { exeName: "a.exe", appName: "A", startMs: D1 + HOUR, endMs: D1 + 3 * HOUR },
        { exeName: "a.exe", appName: "A", startMs: D1 + 4 * HOUR, endMs: D1 + 5 * HOUR },
        { exeName: "b.exe", appName: "B", startMs: D1 + 6 * HOUR, endMs: D1 + 7 * HOUR },
      ],
    });
    expect(aggregate.apps.map((row) => row.key)).toEqual(["a.exe", "b.exe"]);
    expect(aggregate.apps[0].durationMs).toBe(3 * HOUR);
    expect(aggregate.apps[0].share).toBeCloseTo(0.75, 5);
    expect(aggregate.apps[1].share).toBeCloseTo(0.25, 5);
  });
});

describe("buildHistoryRangeAggregate · 事项按 startedAt + 累计秒", () => {
  it("b01_merges_by_item_and_counts_records", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      records: [
        { itemId: 7, seconds: 600, startedAt: D1 + HOUR },
        { itemId: 7, seconds: 300, startedAt: D1 + 2 * HOUR },
        { itemId: 9, seconds: 120, startedAt: D2 + HOUR },
      ],
      items: [{ id: 7, name: "写方案" }, { id: 9, name: "复盘" }],
    });
    expect(aggregate.items.map((row) => row.name)).toEqual(["写方案", "复盘"]);
    expect(aggregate.items[0].durationMs).toBe(15 * 60 * 1000);
    expect(aggregate.items[0].recordCount).toBe(2);
    expect(aggregate.timingMs).toBe(17 * 60 * 1000);
    /* 事项按记录起始时刻落到那一天：day0 两条、day1 一条 */
    expect(aggregate.days[0].timingMs).toBe(15 * 60 * 1000);
    expect(aggregate.days[1].timingMs).toBe(2 * 60 * 1000);
  });

  it("b02_record_started_before_the_range_is_excluded", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      records: [{ itemId: 7, seconds: 600, startedAt: D1 - 1000 }],
      items: [{ id: 7, name: "写方案" }],
    });
    expect(aggregate.items).toEqual([]);
    expect(aggregate.timingMs).toBe(0);
  });

  it("b03_unknown_item_falls_back_to_the_unnamed_label", () => {
    /* 宿主把无名字的计时挂在 `SYSTEM_ITEM_ID` 上，事项表里查不到名字 */
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      records: [{ itemId: 1, seconds: 60, startedAt: D1 + HOUR }],
      items: [],
    });
    expect(aggregate.items[0].name).toBe("未命名计时");
  });
});

describe("buildHistoryRangeAggregate · 便利贴与待办", () => {
  it("c01_notes_are_bucketed_by_created_at", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      notes: [
        { id: 1, itemId: 7, content: "第一行\n第二行", createdAt: D1 + HOUR },
        { id: 2, itemId: null, content: "区外", createdAt: D1 - HOUR },
        { id: 3, itemId: 9, content: "第二天", createdAt: D2 + HOUR },
      ],
      items: [{ id: 7, name: "写方案" }, { id: 9, name: "复盘" }],
    });
    expect(aggregate.noteCount).toBe(2);
    expect(aggregate.notes.map((note) => note.id)).toEqual([3, 1]);
    expect(aggregate.notes[1].itemName).toBe("写方案");
    expect(aggregate.notes[0].itemName).toBe("复盘");
    expect(aggregate.days[0].noteCount).toBe(1);
    expect(aggregate.days[1].noteCount).toBe(1);
  });

  it("c02_todos_count_only_completed_inside_the_range", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      todos: [
        { id: 1, title: "完成", plannedAt: D1, doneAt: D2 + HOUR },
        { id: 2, title: "未完成", plannedAt: D1, doneAt: null },
        { id: 3, title: "区外完成", plannedAt: D1, doneAt: D1 - HOUR },
      ],
    });
    expect(aggregate.todoDoneCount).toBe(1);
    expect(aggregate.todos.map((todo) => todo.title)).toEqual(["完成"]);
    expect(aggregate.days[1].todoDoneCount).toBe(1);
    expect(aggregate.days[0].todoDoneCount).toBe(0);
  });
});

describe("buildHistoryRangeAggregate · 空与降级", () => {
  it("d01_empty_inputs_still_return_the_day_scaffold", () => {
    /* 四类都空（库半就绪 / 单个源失败降级成 []）时，逐日柱仍要有 2 根空柱，
       否则界面会从"两天"跳成"没有区间" */
    const aggregate = buildHistoryRangeAggregate(baseInput);
    expect(aggregate.days).toHaveLength(2);
    expect(aggregate.days.every((day) => day.appMs === 0 && day.timingMs === 0)).toBe(true);
    expect(aggregate.activityMs).toBe(0);
    expect(aggregate.apps).toEqual([]);
    expect(aggregate.activeDayCount).toBe(0);
  });

  it("d02_active_day_count_counts_days_with_any_activity", () => {
    const aggregate = buildHistoryRangeAggregate({
      ...baseInput,
      sessions: [{ exeName: "a.exe", appName: "A", startMs: D1 + HOUR, endMs: D1 + 2 * HOUR }],
      records: [{ itemId: 9, seconds: 60, startedAt: D2 + HOUR }],
      items: [{ id: 9, name: "复盘" }],
    });
    expect(aggregate.activeDayCount).toBe(2);
  });

  it("d03_zero_length_days_yield_an_empty_aggregate", () => {
    const aggregate = buildHistoryRangeAggregate({ ...baseInput, days: [] });
    expect(aggregate.days).toEqual([]);
    expect(aggregate.apps).toEqual([]);
  });
});
