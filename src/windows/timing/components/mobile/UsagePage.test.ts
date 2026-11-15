import { describe, expect, it } from 'vitest';
import { formatDuration, monthDayShort, monthDayText, shortName, weekdayShort } from './usageFormat';
import { TREND_DAYS, recentDayKeys, shiftDayKey, todayKey } from '../../services/usageActions';

/**
 * [0.13.0] 统计页的纯函数判据（[0.13.1] 增加日键算术）。
 *
 * 为什么只钉这些：页面本身的几种状态（未授权 / 不支持 / 有数据 / 读不到某天）要真机才能验，
 * 但「时长怎么显示」「包名怎么显示」「往前翻一天是哪一天」都是纯函数。其中**日键算术**
 * 是本轮最容易静默出错的一处：算错一天不会报错，只会让「看昨天」显示成前天。
 */
describe('formatDuration', () => {
  it('u01a_under_an_hour_shows_minutes_only', () => {
    expect(formatDuration(0)).toBe('0m');
    expect(formatDuration(59)).toBe('0m');
    expect(formatDuration(60)).toBe('1m');
    expect(formatDuration(3_599)).toBe('59m');
  });

  it('u01b_over_an_hour_pads_the_minutes_to_two_digits', () => {
    expect(formatDuration(3_600)).toBe('1h 00m');
    expect(formatDuration(3_900)).toBe('1h 05m');
    expect(formatDuration(7_200 + 60 * 42)).toBe('2h 42m');
  });

  it('u01c_negative_input_is_clamped_not_rendered_as_minus', () => {
    expect(formatDuration(-5)).toBe('0m');
  });
});

describe('shortName', () => {
  it('u02a_takes_the_last_package_segment_and_capitalizes_it', () => {
    expect(shortName('com.tencent.mm')).toBe('Mm');
    expect(shortName('com.android.chrome')).toBe('Chrome');
  });

  it('u02b_handles_packages_without_dots', () => {
    expect(shortName('systemui')).toBe('Systemui');
    expect(shortName('')).toBe('');
  });
});

describe('todayKey', () => {
  it('u03a_is_a_local_yyyy_mm_dd_key', () => {
    expect(todayKey(new Date(2026, 10, 11, 23, 59))).toBe('2026-11-11');
    expect(todayKey(new Date(2026, 0, 2, 0, 0))).toBe('2026-01-02');
  });
});

describe('shiftDayKey', () => {
  /** 跨月 / 跨年 / 闰年都交给 Date，自己按天数加减必然在这三处错一天。 */
  it('u04a_crosses_month_and_year_boundaries', () => {
    expect(shiftDayKey('2026-11-30', 1)).toBe('2026-12-01');
    expect(shiftDayKey('2026-12-31', 1)).toBe('2027-01-01');
    expect(shiftDayKey('2026-01-01', -1)).toBe('2025-12-31');
    expect(shiftDayKey('2026-03-01', -1)).toBe('2026-02-28');
    expect(shiftDayKey('2028-02-28', 1)).toBe('2028-02-29');
  });

  it('u04b_zero_delta_is_the_same_day', () => {
    expect(shiftDayKey('2026-11-15', 0)).toBe('2026-11-15');
  });

  /**
   * 非法键**原样返回**，不许静默变成今天：那样「翻到某一天读不到」会变成
   * 「一直显示今天」，用户以为按钮坏了但页面完全正常。
   */
  it('u04c_invalid_key_is_returned_unchanged', () => {
    expect(shiftDayKey('2026-02-30', 1)).toBe('2026-02-30');
    expect(shiftDayKey('2026-13-01', -1)).toBe('2026-13-01');
    expect(shiftDayKey('', 1)).toBe('');
  });
});

describe('recentDayKeys', () => {
  it('u05a_is_oldest_first_and_ends_with_the_anchor', () => {
    const keys = recentDayKeys('2026-11-15', TREND_DAYS);
    expect(keys).toHaveLength(7);
    expect(keys[0]).toBe('2026-11-09');
    expect(keys[6]).toBe('2026-11-15');
  });

  it('u05b_empty_or_bad_count_yields_nothing', () => {
    expect(recentDayKeys('2026-11-15', 0)).toEqual([]);
    expect(recentDayKeys('2026-11-15', -3)).toEqual([]);
  });
});

describe('日期文字', () => {
  it('u06a_weekday_matches_the_real_calendar', () => {
    /* 2026-11-15 是周日，14 号周六 */
    expect(weekdayShort('2026-11-15')).toBe('周日');
    expect(weekdayShort('2026-11-14')).toBe('周六');
    expect(weekdayShort('not-a-date')).toBe('');
  });

  /** 不写「11月9日」：375px 的日期条塞不下四个汉字加两个箭头。 */
  it('u06b_month_day_is_compact_and_unpadded', () => {
    expect(monthDayShort('2026-11-09')).toBe('11/9');
    expect(monthDayShort('2026-01-02')).toBe('1/2');
    expect(monthDayText('2026-11-15')).toBe('11/15 周日');
  });
});
