import { describe, expect, it } from 'vitest';
import { formatDuration, shortName } from './UsagePage';
import { todayKey } from '../../services/usageActions';

/**
 * [0.13.0] 统计页的两条纯函数判据。
 *
 * 为什么只钉这两个：页面本身的三种状态（未授权 / 不支持 / 有数据）要真机才能验，
 * 但「时长怎么显示」和「包名怎么显示」是纯函数，钉住它们能防住最容易返工的两处 ——
 * 一是把 3599 秒显示成 59m（少算一分钟），二是把 `com.tencent.mm` 原样糊在界面上。
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
