import { describe, expect, it } from "vitest";

import { expandTodoBatch, TODO_BATCH_MAX } from "./todoBatch";

/**
 * 批量展开 `expandTodoBatch` 的判据（0.13 · 1.7，多日期 × 多时刻）。
 *
 * 为什么每个 issue 都要钉：七条校验里**任何一条**漏拦，症状都是静默或误导的 ——
 *   · `datePast` 不拦 → `purge_overdue`（15s 一轮）把过去的待办**软删除**，
 *     "建了 15 秒内原地消失"，零报错零撤销条；
 *   · `tooMany` 不拦 → IPC 到 Rust 才拒，用户白打一整表单；
 *   · `noSlot` 不拦 → 笛卡尔积展开成 **0 条**，`createBatch` 返回 false，
 *     用户只看到一句笼统的"创建失败"；
 *   · `remindPast` 不拦 → 宿主 `nudge_due` 的 grace 窗口不会补弹，提醒静默失效。
 *
 * 同时钉「issue !== null 时 plans 恒空」：不存在"带病部分展开"。
 */

const NOW = new Date(2026, 10, 11, 12, 0, 0).getTime();

const OK = { title: "背单词", dates: ["2026-11-12"], times: ["09:00"], remind: false };

describe("expandTodoBatch · 多日期 × 多时刻", () => {
  it("b01_cartesian_product_dates_x_times_in_ascending_order", () => {
    const result = expandTodoBatch({
      title: "背单词",
      dates: ["2026-11-13", "2026-11-12"],
      times: ["21:00", "09:00"],
      remind: false,
    }, NOW);
    expect(result.issue).toBeNull();
    /* 2 日期 × 2 时刻 = 4 条；日期升序 × 时刻升序（同一天早上排前） */
    expect(result.plans).toHaveLength(4);
    expect(result.plans[0].title).toBe("背单词");
    expect(result.plans[0].plannedAt).toBe(new Date(2026, 10, 12, 9, 0).getTime());
    expect(result.plans[1].plannedAt).toBe(new Date(2026, 10, 12, 21, 0).getTime());
    expect(result.plans[2].plannedAt).toBe(new Date(2026, 10, 13, 9, 0).getTime());
    expect(result.plans[3].plannedAt).toBe(new Date(2026, 10, 13, 21, 0).getTime());
  });

  it("b02_remind_on_lands_remindAt_equal_to_plannedAt_off_lands_null", () => {
    /* 提醒语义与单条路径同一条规则（Q2 裁决：不加 planned_end_at，不写 0009） */
    const on = expandTodoBatch({ ...OK, remind: true }, NOW);
    expect(on.issue).toBeNull();
    expect(on.plans[0].remindAt).toBe(on.plans[0].plannedAt);
    const off = expandTodoBatch(OK, NOW);
    expect(off.plans[0].remindAt).toBeNull();
  });

  it("b03_duplicate_dates_and_times_collapse_to_one_plan_each", () => {
    const result = expandTodoBatch({
      title: "背单词",
      dates: ["2026-11-12", "2026-11-12", " 2026-11-12 "],
      times: ["09:00", "09:00"],
      remind: false,
    }, NOW);
    expect(result.plans).toHaveLength(1);
  });

  it("b04_issue_order_name_slots_then_format_then_count", () => {
    /* 空名赢过一切 */
    expect(expandTodoBatch({ ...OK, title: "  " }, NOW).issue).toBe("emptyName");
    /* 名称与槽位同时不合法：槽位也是名称之后 */
    expect(expandTodoBatch({ ...OK, title: "x".repeat(201) }, NOW).issue).toBe("nameTooLong");
    expect(expandTodoBatch({ ...OK, dates: [], times: [] }, NOW).issue).toBe("noSlot");
    expect(expandTodoBatch({ ...OK, dates: ["2026-11-12"], times: [] }, NOW).issue).toBe("noSlot");
    expect(expandTodoBatch({ ...OK, times: ["9:0"] }, NOW).issue).toBe("timeInvalid");
    expect(expandTodoBatch({ ...OK, dates: ["2026-13-01"] }, NOW).issue).toBe("timeInvalid");
  });

  it("b05_more_than_max_plans_is_rejected_not_truncated", () => {
    /* 8 日期 × 8 时刻 = 64 > 60：整批拒绝，不是截到 60 —— "截断"会让用户少建 4 条
       而没有任何提示 */
    expect(expandTodoBatch({
      title: "背单词",
      dates: Array.from({ length: 8 }, (_, i) => `2026-11-${12 + i}`),
      times: Array.from({ length: 8 }, (_, i) => `${String(9 + i).padStart(2, "0")}:00`),
      remind: false,
    }, NOW).issue).toBe("tooMany");
    /* 恰好 60 条合法（5 × 12 的最重合法用法） */
    expect(expandTodoBatch({
      title: "背单词",
      dates: Array.from({ length: 5 }, (_, i) => `2026-11-${12 + i}`),
      times: Array.from({ length: 12 }, (_, i) => `${String(i).padStart(2, "0")}:00`),
      remind: false,
    }, NOW).issue).toBeNull();
    /* 前端与 Rust 同值（1..=60）：常量别单方面漂移 */
    expect(TODO_BATCH_MAX).toBe(60);
  });

  it("b06_a_date_before_today_is_rejected_purge_overdue_would_eat_it", () => {
    /* 今天 0 点之前 = 会被 purge_overdue 软删（15s 内原地消失）——硬校验 */
    expect(expandTodoBatch({ ...OK, dates: ["2026-11-10"] }, NOW).issue).toBe("datePast");
    /* 今天本身合法（哪怕时刻已过 —— 补记是合法用法，提醒才另拦） */
    expect(expandTodoBatch({ ...OK, dates: ["2026-11-11"] }, NOW).issue).toBeNull();
  });

  it("b07_remind_on_a_past_moment_is_rejected_the_nudge_will_not_refire", () => {
    /* 勾了提醒 + 时刻 <= now → 提醒不会补弹，整批拒绝（今天 09:00 < now 12:00） */
    expect(expandTodoBatch({ ...OK, dates: ["2026-11-11"], times: ["09:00"], remind: true }, NOW).issue)
      .toBe("remindPast");
    /* 不勾提醒：同一时刻合法（补记语义） */
    expect(expandTodoBatch({ ...OK, times: ["09:00"], remind: false }, NOW).issue).toBeNull();
    /* 提醒 + 严格晚于 now：合法 */
    expect(expandTodoBatch({ ...OK, dates: ["2026-11-11"], times: ["12:01"], remind: true }, NOW).issue).toBeNull();
  });

  it("b08_an_issue_never_returns_a_partial_plan_list", () => {
    /* "带病部分展开"是最坏的返回形态：调用方只看一边 */
    const result = expandTodoBatch({ ...OK, dates: ["2026-11-10", "2026-11-12"], remind: false }, NOW);
    expect(result.issue).toBe("datePast");
    expect(result.plans).toHaveLength(0);
  });
});
