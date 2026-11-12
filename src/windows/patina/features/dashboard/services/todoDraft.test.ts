import { describe, expect, it } from "vitest";

import {
  TODO_TITLE_MAX_CHARS,
  formatDateTimeLocal,
  parseDateTimeLocal,
  planTodoWrite,
  reminderClock,
  validateTodoDraft,
} from "./todoDraft.ts";

/**
 * 「新建待办」纯函数的判据（[本轮] 时间口径的唯一实现，组件里不许再写一遍三元）。
 *
 * 时刻一律用 `new Date(y, mo, d, h, mi)` 本地构造，**不写 UTC 毫秒字面量**：
 * `parseDateTimeLocal` / `formatDateTimeLocal` / `reminderClock` 都是本地时区口径，
 * 写死 UTC 数在 UTC+8 之外的机器上会红（CI 时区不可假设）。
 */
const at = (y: number, mo: number, d: number, h: number, mi: number): number =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe("parseDateTimeLocal · 本地 YYYY-MM-DDTHH:mm 手解", () => {
  it("td01_parses_a_valid_local_datetime_to_local_milliseconds", () => {
    const ms = parseDateTimeLocal("2026-11-12T21:05");
    expect(ms).toBe(at(2026, 11, 12, 21, 5));
  });

  it("td02_empty_and_dirty_strings_return_null_without_throwing", () => {
    for (const dirty of ["", "   ", "abc", "2026-11-12", "2026-11-12T21", "21:05", "2026-11-12T21:00:00"]) {
      expect(parseDateTimeLocal(dirty), dirty).toBeNull();
    }
  });

  it("td03_out_of_range_components_return_null", () => {
    expect(parseDateTimeLocal("2026-13-01T00:00"), "月 > 12").toBeNull();
    expect(parseDateTimeLocal("2026-00-10T00:00"), "月 = 0").toBeNull();
    expect(parseDateTimeLocal("2026-11-12T25:00"), "时 > 23").toBeNull();
    expect(parseDateTimeLocal("2026-11-12T21:60"), "分 > 59").toBeNull();
    expect(parseDateTimeLocal("2026-11-00T21:00"), "日 = 0").toBeNull();
    expect(parseDateTimeLocal("2026-11-31T21:00"), "11 月没有 31 日").toBeNull();
    expect(parseDateTimeLocal("2026-02-30T21:00"), "别依赖 Date 的自动进位").toBeNull();
  });

  it("td04_roundtrip_format_then_parse_is_identity", () => {
    for (const value of ["2026-11-12T21:05", "2026-01-15T00:00", "2026-07-01T12:34", "2099-12-31T23:59"]) {
      expect(formatDateTimeLocal(parseDateTimeLocal(value) as number)).toBe(value);
    }
  });

  it("td05_format_renders_local_components_and_rejects_non_finite", () => {
    expect(formatDateTimeLocal(at(2026, 3, 5, 9, 7))).toBe("2026-03-05T09:07");
    expect(formatDateTimeLocal(Number.NaN)).toBe("");
  });
});

describe("validateTodoDraft · 名称 → 时间格式 → 时间过期", () => {
  const base = { timeLocal: "2030-01-01T09:00", remind: false, nowMs: at(2026, 11, 12, 12, 0) };

  it("td06_empty_name_is_caught_first", () => {
    expect(validateTodoDraft({ ...base, title: "" })).toBe("emptyName");
    expect(validateTodoDraft({ ...base, title: "   " })).toBe("emptyName");
  });

  it("td07_name_longer_than_200_is_caught_before_the_time", () => {
    expect(validateTodoDraft({ ...base, title: "a".repeat(TODO_TITLE_MAX_CHARS + 1) })).toBe("nameTooLong");
    expect(validateTodoDraft({ ...base, title: "a".repeat(TODO_TITLE_MAX_CHARS) })).toBeNull();
  });

  it("td08_a_non_empty_unparsable_time_is_timeInvalid", () => {
    expect(validateTodoDraft({ ...base, title: "看论文", timeLocal: "2026-13-01T00:00" })).toBe("timeInvalid");
    expect(validateTodoDraft({ ...base, title: "看论文", timeLocal: "2030-01-01T25:00" })).toBe("timeInvalid");
  });

  it("td09_a_past_time_with_remind_is_blocked_but_is_legal_without_it", () => {
    const past = { ...base, timeLocal: "2026-11-11T09:00", title: "补记昨天" };
    expect(validateTodoDraft({ ...past, remind: true })).toBe("timePast");
    /* 不勾提醒时允许过去时间：补记「昨天该做没做」是合法用法（行上自然显示红胶囊） */
    expect(validateTodoDraft({ ...past, remind: false })).toBeNull();
  });

  /* [QA 补] 边界：时间**恰好等于现在**也要拦（`<=` 不是 `<`）。
   * 宿主 nudge 的 grace 窗只容忍到点后几分钟，等于现在的时刻提交瞬间就已过期。
   * 没有这条，把 `<=` 手滑改成 `<` 不会红。 */
  it("td09b_a_time_exactly_equal_to_now_is_blocked_when_remind_is_ticked", () => {
    const now = at(2026, 11, 12, 12, 0);
    expect(validateTodoDraft({
      title: "边界",
      timeLocal: "2026-11-12T12:00",
      remind: true,
      nowMs: now,
    })).toBe("timePast");
    /* 同一时刻不勾提醒：补记合法（与 td09 同一条口径的边界形态） */
    expect(validateTodoDraft({
      title: "边界",
      timeLocal: "2026-11-12T12:00",
      remind: false,
      nowMs: now,
    })).toBeNull();
  });

  it("td10_no_time_passes_validation_even_with_remind_ticked", () => {
    expect(validateTodoDraft({ title: "看论文", timeLocal: "", remind: true, nowMs: base.nowMs })).toBeNull();
  });
});

describe("planTodoWrite · 一个时间落两个字段的唯一口径", () => {
  it("td11_remind_ticked_writes_the_same_moment_into_both_fields", () => {
    const plan = planTodoWrite({ title: "  看论文  ", timeLocal: "2030-01-01T09:00", remind: true });
    expect(plan.title).toBe("看论文");
    expect(plan.plannedAt).toBe(at(2030, 1, 1, 9, 0));
    /* 同一个值，不是两次解析：`toBe` 是同值断言，漂一个毫秒都红 */
    expect(plan.remindAt).toBe(plan.plannedAt);
  });

  it("td12_remind_untouched_keeps_remindAt_null_and_still_writes_plannedAt", () => {
    const plan = planTodoWrite({ title: "看论文", timeLocal: "2030-01-01T09:00", remind: false });
    expect(plan.plannedAt).toBe(at(2030, 1, 1, 9, 0));
    expect(plan.remindAt).toBeNull();
  });

  it("td13_no_time_lands_both_fields_null_even_when_remind_is_ticked", () => {
    const plan = planTodoWrite({ title: "随手一条", timeLocal: "", remind: true });
    expect(plan.plannedAt).toBeNull();
    expect(plan.remindAt).toBeNull();
  });
});

describe("reminderClock · 铃铛 aria-label 的时刻", () => {
  it("td14_renders_local_HH_mm_zero_padded", () => {
    expect(reminderClock(at(2026, 11, 12, 9, 5))).toBe("09:05");
    expect(reminderClock(at(2026, 11, 12, 23, 59))).toBe("23:59");
    expect(reminderClock(Number.NaN)).toBe("");
  });
});
