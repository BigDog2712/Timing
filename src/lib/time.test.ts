/**
 * Timing — 记录范围算法单测（V0.11.31）
 * -----------------------------------------------------------------------------
 * 钉住五档区间的**边界**，因为这些边界错了不会报错，只会安静地少算几天：
 *   - 周一当天选「本周」= 只有今天（很多人以为是 bug，其实是口径）；
 *   - 「近七天」是 7 个自然日，不是 168 小时；
 *   - 12 月选「本月」要跨年；
 *   - `2026-02-30` 这种不存在的日期不能被 Date 悄悄顺延成 3 月 2 日。
 *
 * 全部用本地时区构造（`new Date(y, m-1, d, ...)`），与实现同口径——
 * 用 `Date.UTC` 写断言在别的时区会变成另一天，那种测试只能证明时区差。
 */
import { describe, expect, it } from 'vitest';
import {
  dateInputValue,
  parseDateInput,
  parseDateTimeInput,
  rangeBounds,
  rangeHint,
  rangeLabel,
  timeInputValue,
} from './time';

/** 本地时刻 → epoch 毫秒（月份按人话从 1 开始） */
function at(year: number, month: number, day: number, hour = 0, minute = 0): number {
  return new Date(year, month - 1, day, hour, minute, 0, 0).getTime();
}

describe('rangeBounds · 今天 / 往日', () => {
  it('day_is_the_whole_local_day', () => {
    expect(rangeBounds('day', at(2026, 11, 9, 15, 30))).toEqual({
      from: at(2026, 11, 9),
      to: at(2026, 11, 10),
    });
  });

  it('date_points_at_the_day_you_picked', () => {
    expect(rangeBounds('date', at(2026, 3, 5, 10))).toEqual({
      from: at(2026, 3, 5),
      to: at(2026, 3, 6),
    });
  });
});

describe('rangeBounds · 本周', () => {
  /** 2026-11-09 是周一：本周 = 只有今天，这是口径不是 bug。 */
  it('monday_start_of_week_is_that_same_day', () => {
    expect(rangeBounds('week', at(2026, 11, 9, 9))).toEqual({
      from: at(2026, 11, 9),
      to: at(2026, 11, 16),
    });
  });

  /** 周日属于「上一个周一」起的那一周（ISO 周，周一为首日）。 */
  it('sunday_belongs_to_the_week_started_last_monday', () => {
    expect(rangeBounds('week', at(2026, 11, 15, 23))).toEqual({
      from: at(2026, 11, 9),
      to: at(2026, 11, 16),
    });
  });
});

describe('rangeBounds · 近七天 / 本月', () => {
  /** 含今天在内的 7 个自然日：11-03 00:00 到 11-10 00:00。 */
  it('last7_covers_seven_calendar_days_including_today', () => {
    expect(rangeBounds('last7', at(2026, 11, 9, 15))).toEqual({
      from: at(2026, 11, 3),
      to: at(2026, 11, 10),
    });
  });

  /** 跨月：11-02 的近七天要回到 10 月，不能停在 11-01。 */
  it('last7_crosses_the_month_boundary', () => {
    expect(rangeBounds('last7', at(2026, 11, 2, 8))).toEqual({
      from: at(2026, 10, 27),
      to: at(2026, 11, 3),
    });
  });

  it('month_runs_from_the_first_to_the_next_first', () => {
    expect(rangeBounds('month', at(2026, 11, 9, 15))).toEqual({
      from: at(2026, 11, 1),
      to: at(2026, 12, 1),
    });
  });

  /** 12 月「本月」的下界是**次年** 1 月 1 日。 */
  it('december_month_rolls_into_the_next_year', () => {
    expect(rangeBounds('month', at(2026, 12, 15))).toEqual({
      from: at(2026, 12, 1),
      to: at(2027, 1, 1),
    });
  });
});

describe('文案与输入框格式', () => {
  it('labels_say_what_the_range_is', () => {
    expect(rangeLabel('day')).toBe('今天');
    expect(rangeLabel('week')).toBe('本周');
    expect(rangeLabel('last7')).toBe('近七天');
    expect(rangeLabel('month')).toBe('本月');
    /* 往日必须把具体哪天写出来，只写「往日」等于没说清 */
    expect(rangeLabel('date', at(2026, 11, 9))).toBe('11 月 9 日');
  });

  it('hints_explain_the_boundaries', () => {
    expect(rangeHint('last7')).toContain('7 个自然日');
    expect(rangeHint('week')).toContain('周一');
  });

  it('date_input_uses_local_time_not_utc', () => {
    /* 东八区的 11-09 00:30 用 toISOString 会变成 11-08，那正是要避免的 */
    expect(dateInputValue(at(2026, 11, 9, 0, 30))).toBe('2026-11-09');
    expect(timeInputValue(at(2026, 11, 9, 7, 5))).toBe('07:05');
  });

  it('rejects_dates_that_do_not_exist', () => {
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('2026-13-01')).toBeNull();
    expect(parseDateInput('2026-11-09')).toBe(at(2026, 11, 9));
  });

  it('joins_date_and_time_into_one_instant', () => {
    expect(parseDateTimeInput('2026-11-09', '07:05')).toBe(at(2026, 11, 9, 7, 5));
    expect(parseDateTimeInput('2026-11-09', '25:00')).toBeNull();
    expect(parseDateTimeInput('oops', '07:05')).toBeNull();
  });
});
