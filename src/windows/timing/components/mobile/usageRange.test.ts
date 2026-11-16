/**
 * Timing — 统计页区间算术的判据（[0.13.2]）
 * -----------------------------------------------------------------------------
 * 这一份钉的是「近 7 天」把多天合并成一个读数时的四件易错事：
 *   ① 合并时**没读到的天不许当 0 摊进日均**（否则日均被压低，且零报错）；
 *   ② `first` / `last` 的 0 是「不知道」而不是「零点」（拿 0 去 MIN 会显示 00:00）；
 *   ③ 取前 N 条之后**列表之和必须仍等于合计**（否则用户对不上账）；
 *   ④ 并列时长时排序稳定（不依赖 Map 插入顺序，否则每次刷新行序会抖）。
 */
import { describe, expect, it } from 'vitest';
import {
  appSeries,
  deltaSec,
  mergeRows,
  percentOf,
  rangeOf,
  topRows,
} from '../../services/usageRange';
import type { UsageDayDto } from '../../types/domain/usage';

function dayOf(
  date: string,
  rows: {
    pkg: string;
    sec: number;
    first?: number;
    last?: number;
    label?: string;
    icon?: string;
  }[],
): UsageDayDto {
  return {
    supported: true,
    date,
    totalSec: rows.reduce((sum, row) => sum + row.sec, 0),
    rows: rows.map((row) => ({
      packageName: row.pkg,
      sec: row.sec,
      first: row.first ?? 0,
      last: row.last ?? 0,
      /* 默认空串 = 「系统没给名字」，与真实回值里「包已卸载」同一种状态 */
      label: row.label ?? '',
      icon: row.icon ?? '',
    })),
  };
}

describe('mergeRows', () => {
  it('r01a_sums_the_same_package_across_days_and_counts_them', () => {
    const rows = mergeRows([
      dayOf('2026-11-13', [{ pkg: 'com.tencent.mm', sec: 600 }]),
      dayOf('2026-11-14', [{ pkg: 'com.tencent.mm', sec: 300 }]),
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ packageName: 'com.tencent.mm', sec: 900, days: 2 });
  });

  it('r01b_zero_first_last_never_wins_the_min_max', () => {
    /* 第二天没采到时刻（0）—— 合并后必须保留第一天的 08:00，而不是被 0 拉成 1970 年 */
    const rows = mergeRows([
      dayOf('2026-11-13', [{ pkg: 'a.b', sec: 60, first: 1_700_000_000_000, last: 1_700_000_600_000 }]),
      dayOf('2026-11-14', [{ pkg: 'a.b', sec: 60 }]),
    ]);
    expect(rows[0].first).toBe(1_700_000_000_000);
    expect(rows[0].last).toBe(1_700_000_600_000);
  });

  it('r01c_empty_package_and_non_positive_seconds_are_dropped', () => {
    const rows = mergeRows([dayOf('2026-11-14', [{ pkg: '', sec: 10 }, { pkg: 'x.y', sec: 0 }])]);
    expect(rows).toEqual([]);
  });

  /**
   * 名字与图标跨天合并时**只补空位、不覆盖**。
   *
   * 真实场景：某个包在 11/13 那天取不到图标（装之前用过、或那次 PackageManager 抽风），
   * 11/14 取到了。若按「后写覆盖」或「先写死不变」，要么图标永远空白，要么被空串覆盖成空白 ——
   * 两种都是「看着像没数据」的静默错。
   */
  it('r01e_label_and_icon_survive_merging_and_fill_only_blanks', () => {
    const rows = mergeRows([
      dayOf('2026-11-13', [{ pkg: 'com.tencent.mm', sec: 60 }]),
      dayOf('2026-11-14', [
        { pkg: 'com.tencent.mm', sec: 60, label: '微信', icon: 'data:image/webp;base64,AA' },
      ]),
      dayOf('2026-11-15', [
        { pkg: 'com.tencent.mm', sec: 60, label: '别的名字', icon: 'data:image/webp;base64,BB' },
      ]),
    ]);
    expect(rows[0].label).toBe('微信');
    expect(rows[0].icon).toBe('data:image/webp;base64,AA');
  });

  it('r01d_ties_are_broken_by_package_name_not_insertion_order', () => {
    const rows = mergeRows([
      dayOf('2026-11-14', [{ pkg: 'zz.top', sec: 60 }, { pkg: 'aa.app', sec: 60 }]),
    ]);
    expect(rows.map((row) => row.packageName)).toEqual(['aa.app', 'zz.top']);
  });
});

describe('rangeOf', () => {
  it('r02a_average_divides_by_loaded_days_only', () => {
    /* 两天有数据、合计 900s → 日均 450s。窗口是 7 天，但另 5 天**没读到**，不能摊进去 */
    const range = rangeOf([
      dayOf('2026-11-13', [{ pkg: 'a.b', sec: 600 }]),
      dayOf('2026-11-14', [{ pkg: 'a.b', sec: 300 }]),
    ]);
    expect(range.dayCount).toBe(2);
    expect(range.totalSec).toBe(900);
    expect(range.avgPerDaySec).toBe(450);
  });

  it('r02b_empty_input_is_zero_not_NaN', () => {
    const range = rangeOf([]);
    expect(range).toMatchObject({ dayCount: 0, totalSec: 0, avgPerDaySec: 0, rows: [] });
  });

  it('r02c_total_matches_the_sum_of_rows', () => {
    const range = rangeOf([dayOf('2026-11-14', [{ pkg: 'a', sec: 120 }, { pkg: 'b', sec: 30 }])]);
    expect(range.totalSec).toBe(range.rows.reduce((sum, row) => sum + row.sec, 0));
  });
});

describe('topRows', () => {
  const rows = [
    { packageName: 'a', sec: 100, first: 0, last: 0, days: 3, spanCount: 0, label: '', icon: '' },
    { packageName: 'b', sec: 90, first: 0, last: 0, days: 2, spanCount: 0, label: '', icon: '' },
    { packageName: 'c', sec: 80, first: 0, last: 0, days: 1, spanCount: 0, label: '', icon: '' },
  ];

  it('r03a_tail_becomes_one_row_so_the_sum_still_matches_the_total', () => {
    const { top, rest } = topRows(rows, 2);
    expect(top.map((row) => row.packageName)).toEqual(['a', 'b']);
    expect(rest?.packageName).toBe('其他 1 个应用');
    expect((rest?.sec ?? 0) + top.reduce((sum, row) => sum + row.sec, 0)).toBe(270);
  });

  it('r03b_no_tail_when_rows_fit_the_limit', () => {
    expect(topRows(rows, 10)).toEqual({ top: rows, rest: null });
  });

  it('r03c_non_positive_limit_keeps_everything_instead_of_dropping_rows', () => {
    /* limit=0 传进来时若「截断到 0 条 + 无 rest」，合计就凭空少一截且零报错 */
    expect(topRows(rows, 0).top).toHaveLength(3);
  });
});

describe('deltaSec / appSeries / percentOf', () => {
  it('r04a_delta_is_null_when_either_side_is_missing', () => {
    const today = dayOf('2026-11-14', [{ pkg: 'a', sec: 100 }]);
    expect(deltaSec(today, undefined)).toBeNull();
    expect(deltaSec(undefined, today)).toBeNull();
    expect(deltaSec(today, dayOf('2026-11-13', [{ pkg: 'a', sec: 40 }]))).toBe(60);
  });

  it('r04b_app_series_marks_unloaded_days_as_null_but_absent_app_as_zero', () => {
    const days: Record<string, UsageDayDto | undefined> = {
      '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a', sec: 60 }]),
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'b', sec: 30 }]),
    };
    expect(appSeries(days, ['2026-11-12', '2026-11-13', '2026-11-14'], 'a')).toEqual([null, 60, 0]);
  });

  it('r04c_percent_never_divides_by_zero', () => {
    expect(percentOf(30, 0)).toBe(0);
    expect(percentOf(30, 120)).toBe(25);
    expect(percentOf(Number.NaN, 120)).toBe(0);
  });
});
