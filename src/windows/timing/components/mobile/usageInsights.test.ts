/**
 * Timing — 统计页洞察句的判据（[0.13.2]）
 * -----------------------------------------------------------------------------
 * 洞察句是「数智」的落点，也是最容易**看起来很聪明、其实在编**的地方。这一份钉住：
 *   ① 昨天没读到 → **不产**对比句（不许把「不知道」说成「少用 100%」）；
 *   ② 差异不到 1 分钟 → 不产（「比昨天少用 0 分钟」是噪音）；
 *   ③ 主因应用必须与总差值同向，找不到就不编理由；
 *   ④ 单应用占比只在当天用够半小时时才说（总共 3 分钟谈占比毫无意义）；
 *   ⑤ 「连续 N 天变多」必须严格逐日上升，且缺天即断；
 *   ⑥ 句子里点的名字必须是**系统给的真名**，不是包名截出来的尾段（`Mm` / `Bili`）。
 */
import { describe, expect, it } from 'vitest';
import { buildInsights } from './usageInsights';
import type { UsageDayDto } from '../../types/domain/usage';

const KEYS = ['2026-11-13', '2026-11-14', '2026-11-15'];

function dayOf(
  date: string,
  rows: { pkg: string; sec: number; label?: string }[],
): UsageDayDto {
  return {
    supported: true,
    date,
    totalSec: rows.reduce((sum, row) => sum + row.sec, 0),
    rows: rows.map((row) => ({
      packageName: row.pkg,
      sec: row.sec,
      first: 0,
      last: 0,
      label: row.label ?? '',
    })),
  };
}

describe('昨日对比', () => {
  it('i01a_says_how_much_more_and_names_the_main_mover', () => {
    const days = {
      '2026-11-14': dayOf('2026-11-14', [
        { pkg: 'com.ss.android.ugc.aweme', sec: 1200 },
        { pkg: 'com.android.chrome', sec: 600 },
      ]),
      '2026-11-15': dayOf('2026-11-15', [
        { pkg: 'com.ss.android.ugc.aweme', sec: 3600 },
        { pkg: 'com.android.chrome', sec: 600 },
      ]),
    };
    const [first] = buildInsights({ days, keys: KEYS, limit: 1 });
    expect(first.tone).toBe('up');
    expect(first.text).toBe('比昨天多用 40 分钟，主要来自 Aweme（+40 分钟）');
  });

  it('i01b_says_less_when_it_dropped', () => {
    const days = {
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 1800 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 600 }]),
    };
    const [first] = buildInsights({ days, keys: KEYS, limit: 1 });
    expect(first.tone).toBe('down');
    expect(first.text).toBe('比昨天少用 20 分钟，主要来自 B（-20 分钟）');
  });

  it('i02a_missing_yesterday_produces_no_comparison_at_all', () => {
    /* 只有今天：读不到昨天就必须闭嘴。产一句「少用 100%」是纯编造 */
    const days = { '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 600 }]) };
    expect(buildInsights({ days, keys: KEYS, limit: 3 })).toEqual([]);
  });

  it('i02b_sub_minute_difference_is_noise_and_skipped', () => {
    const days = {
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 600 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 630 }]),
    };
    expect(buildInsights({ days, keys: KEYS, limit: 3 })).toEqual([]);
  });
});

describe('单应用占比', () => {
  it('i03a_reports_share_only_when_the_day_is_long_enough', () => {
    const busy = {
      '2026-11-15': dayOf('2026-11-15', [
        { pkg: 'com.ss.android.ugc.aweme', sec: 2400 },
        { pkg: 'b.c', sec: 1200 },
      ]),
    };
    expect(buildInsights({ days: busy, keys: KEYS, limit: 1 })[0]).toEqual({
      tone: 'info',
      text: 'Aweme 占了今天的 67%',
    });

    /* 同比例但总共只有 3 分钟：不谈占比 */
    const tiny = {
      '2026-11-15': dayOf('2026-11-15', [
        { pkg: 'com.ss.android.ugc.aweme', sec: 120 },
        { pkg: 'b.c', sec: 60 },
      ]),
    };
    expect(buildInsights({ days: tiny, keys: KEYS, limit: 3 })).toEqual([]);
  });
});

describe('连续上升与最久一天', () => {
  it('i04a_three_consecutive_rises_are_called_out', () => {
    const days = {
      '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a.b', sec: 600 }]),
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 1200 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 1800 }]),
    };
    const texts = buildInsights({ days, keys: KEYS, limit: 5 }).map((item) => item.text);
    expect(texts).toContain('已连续 3 天变多');
  });

  it('i04b_a_missing_day_breaks_the_streak', () => {
    const days = {
      /* 中间那天没读到：不许跨过空缺算「连续」 */
      '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a.b', sec: 600 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 1800 }]),
    };
    const texts = buildInsights({ days, keys: KEYS, limit: 5 }).map((item) => item.text);
    expect(texts.join('|')).not.toContain('连续');
  });

  it('i05a_longest_day_is_reported_only_when_it_is_not_today', () => {
    const days = {
      '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a.b', sec: 3600 }]),
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 300 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 600 }]),
    };
    const texts = buildInsights({ days, keys: KEYS, limit: 5 }).map((item) => item.text);
    expect(texts).toContain('近 3 天里 11/13 用得最久（1h 00m）');
  });

  it('i05b_limit_caps_the_sentence_count', () => {
    const days = {
      '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a.b', sec: 3600 }]),
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 1200 }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 1800 }]),
    };
    expect(buildInsights({ days, keys: KEYS, limit: 2 })).toHaveLength(2);
  });
});

describe('看往日时要说那一天的话（anchor）', () => {
  const days = {
    '2026-11-13': dayOf('2026-11-13', [{ pkg: 'a.b', sec: 600 }]),
    '2026-11-14': dayOf('2026-11-14', [{ pkg: 'a.b', sec: 1800 }]),
    '2026-11-15': dayOf('2026-11-15', [{ pkg: 'a.b', sec: 600 }]),
  };

  it('i06a_comparison_switches_to_the_anchored_day', () => {
    /* 不传 anchor 时这句是「今天(600) 比昨天(1800) 少用 20 分钟」；
       锚到 11/14 之后必须变成「11/14(1800) 比 11/13(600) 多用 20 分钟」 */
    const [first] = buildInsights({ days, keys: KEYS, anchor: '2026-11-14', limit: 1 });
    expect(first.text).toBe('比昨天多用 20 分钟，主要来自 B（+20 分钟）');
  });

  it('i06b_trend_sentences_are_silent_when_anchored_to_the_past', () => {
    /* 「连续变多 / 最久一天」描述的是窗口趋势，看往日时说出来就是时间线错位 */
    const texts = buildInsights({ days, keys: KEYS, anchor: '2026-11-14', limit: 5 }).map(
      (item) => item.text,
    );
    expect(texts.join('|')).not.toContain('连续');
    expect(texts.join('|')).not.toContain('最久');
  });
});

/**
 * 句子里点的名字必须是真名。
 *
 * 0.13.2 之前这里走的是 `shortName()`，于是「主要来自 Mm」「Bili 占了今天的 61%」——
 * 每个字都读得通，但没有一个是对的。判据同时钉**正向**（用真名）与**反向**
 * （不许出现包名尾段），因为只钉正向的话，回落逻辑写反了仍然能过。
 */
describe('名字用系统真名', () => {
  it('i07a_comparison_names_the_app_by_its_real_label', () => {
    const days = {
      '2026-11-14': dayOf('2026-11-14', [{ pkg: 'com.tencent.mm', sec: 600, label: '微信' }]),
      '2026-11-15': dayOf('2026-11-15', [{ pkg: 'com.tencent.mm', sec: 1800, label: '微信' }]),
    };
    const [first] = buildInsights({ days, keys: KEYS, limit: 1 });
    expect(first.text).toBe('比昨天多用 20 分钟，主要来自 微信（+20 分钟）');
    expect(first.text).not.toContain('Mm');
  });

  it('i07b_share_sentence_uses_the_real_label', () => {
    const days = {
      '2026-11-15': dayOf('2026-11-15', [
        { pkg: 'tv.danmaku.bili', sec: 1800, label: '哔哩哔哩' },
        { pkg: 'com.android.chrome', sec: 600 },
      ]),
    };
    const texts = buildInsights({ days, keys: KEYS, limit: 5 }).map((item) => item.text);
    expect(texts.join('|')).toContain('哔哩哔哩 占了今天的 75%');
    expect(texts.join('|')).not.toContain('Bili');
  });
});
