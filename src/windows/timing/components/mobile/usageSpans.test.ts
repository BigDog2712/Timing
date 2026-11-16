/**
 * Timing — 使用时段算术的判据（[0.12.5]）
 * -----------------------------------------------------------------------------
 * 这一份钉的是「9:00-9:30、10:00-10:10」在从后端读数变成一行字之前会静默走偏的六件事：
 *   ① 乱序的段必须排序（否则画出来的时间轴是交错的）；
 *   ② 重叠的段取并集，**不是相加**（相加会让「段之和」大于合计，用户对不上账）；
 *   ③ 首尾相接的段必须合并（中间没有别的应用，本来就是一整段）；
 *   ④ 真断开的段**不许**合并（合并等于编一段没发生过的使用）；
 *   ⑤ 空段与倒挂段丢掉，不产生「09:00-09:00」；
 *   ⑥ 时刻一律本机时区（`clockText`），`toISOString` 会整整早 8 小时且不报错。
 */
import { describe, expect, it } from 'vitest';

import {
  MIN_VISIBLE_SPAN_MS,
  mergeSpans,
  shortSpans,
  spanRawMillis,
  spanClockText,
  spanCountText,
  spanGaps,
  spanLengthCN,
  spansOf,
  visibleSpans,
} from './usageSpans';
import type { UsageSpan } from '../../types/domain/usage';

/** 本地时刻 → 毫秒。**不要写 `Date.parse('2026-11-15T09:00:00')`**：无时区后缀那串
 *  在部分引擎里按 UTC 解，判据本身就会跟实现一起错 8 小时。 */
function at(hour: number, minute = 0): number {
  return new Date(2026, 10, 15, hour, minute, 0, 0).getTime();
}

function span(fromHour: number, fromMin: number, toHour: number, toMin: number): UsageSpan {
  return { from: at(fromHour, fromMin), to: at(toHour, toMin) };
}

describe('mergeSpans', () => {
  it('乱序进来按时间升序出去', () => {
    const out = mergeSpans([span(10, 0, 10, 10), span(9, 0, 9, 30)]);
    expect(out).toEqual([span(9, 0, 9, 30), span(10, 0, 10, 10)]);
  });

  it('重叠取并集，不相加', () => {
    const out = mergeSpans([span(9, 0, 9, 30), span(9, 10, 9, 40)]);
    expect(out).toEqual([span(9, 0, 9, 40)]);
  });

  it('首尾相接合并成一段', () => {
    const out = mergeSpans([span(9, 0, 9, 30), span(9, 30, 10, 0)]);
    expect(out).toEqual([span(9, 0, 10, 0)]);
  });

  it('被包含的短段不会把已经合并的尾巴改小', () => {
    const out = mergeSpans([span(9, 0, 9, 40), span(9, 5, 9, 10)]);
    expect(out).toEqual([span(9, 0, 9, 40)]);
  });

  it('真断开的两段保持分开', () => {
    const out = mergeSpans([span(9, 0, 9, 30), span(10, 0, 10, 10)]);
    expect(out).toEqual([span(9, 0, 9, 30), span(10, 0, 10, 10)]);
  });

  it('≤ 1 分钟的空隙并入两端 —— 同应用换 Activity 的碎段由此消失（0.12.8）', () => {
    /* 59 秒的空隙：回桌面秒回，本就是一次连续使用 */
    const gap59s = 59_000;
    const out = mergeSpans([
      { from: at(9), to: at(9, 30) },
      { from: at(9, 30) + gap59s, to: at(9, 40) },
    ]);
    expect(out).toEqual([{ from: at(9), to: at(9, 40) }]);
    /* 链式：三段各自空隙都不超过 1 分钟，全部并成一段 */
    const chained = mergeSpans([
      { from: at(9), to: at(9, 10) },
      { from: at(9, 10) + 30_000, to: at(9, 20) },
      { from: at(9, 20) + 30_000, to: at(9, 30) },
    ]);
    expect(chained).toEqual([{ from: at(9), to: at(9, 30) }]);
  });

  it('空段与倒挂段丢掉', () => {
    const out = mergeSpans([
      { from: at(9), to: at(9) },
      { from: at(10), to: at(9) },
      span(11, 0, 11, 5),
    ]);
    expect(out).toEqual([span(11, 0, 11, 5)]);
  });

  it('空输入回空数组', () => {
    expect(mergeSpans([])).toEqual([]);
  });

  it('不改动入参（调用方还在用同一份）', () => {
    const input = [span(10, 0, 10, 10), span(9, 0, 9, 30)];
    const snapshot = JSON.parse(JSON.stringify(input)) as UsageSpan[];
    mergeSpans(input);
    expect(input).toEqual(snapshot);
  });
});

describe('spansOf', () => {
  it('没有 spans 键 ⇒ 空数组，不返回 undefined', () => {
    expect(spansOf({})).toEqual([]);
  });

  it('有键就原样归一（排序 + 合并）', () => {
    expect(spansOf({ spans: [span(10, 0, 10, 10), span(9, 0, 9, 30)] })).toHaveLength(2);
  });
});

describe('文案', () => {
  it('「09:00 - 09:30」用本机时区', () => {
    expect(spanClockText(span(9, 0, 9, 30))).toBe('09:00 - 09:30');
  });

  it('长度走 formatSpanCN 的口径', () => {
    expect(spanLengthCN(span(9, 0, 9, 30))).toBe('30 分钟');
    expect(spanLengthCN(span(9, 0, 10, 5))).toBe('1 小时 5 分');
  });

  it('不足 1 秒的段也读成「不到 1 分钟」，不是「0」', () => {
    const tiny: UsageSpan = { from: at(9), to: at(9) + 300 };
    expect(spanLengthCN(tiny)).toBe('不到 1 分钟');
  });

  it('段数是「N 段」，0 也是「0 段」', () => {
    expect(spanCountText(3)).toBe('3 段');
    expect(spanCountText(0)).toBe('0 段');
  });
});

describe('spanGaps', () => {
  it('只统计够长的空档，且从大到小', () => {
    /* 9:00-9:30 → 10:00-10:10 → 12:00-12:30：空档 30 分钟、110 分钟 */
    const gaps = spanGaps([span(9, 0, 9, 30), span(10, 0, 10, 10), span(12, 0, 12, 30)]);
    expect(gaps).toEqual([110 * 60 * 1000, 30 * 60 * 1000]);
  });

  it('切屏瞬间的半分钟不算空档', () => {
    expect(spanGaps([span(9, 0, 9, 30), span(9, 30, 9, 40)])).toEqual([]);
  });

  it('一段也没有 ⇒ 没有空档', () => {
    expect(spanGaps([])).toEqual([]);
  });
});

/**
 * [0.12.8] 「多段不到一分钟」这条反馈的判据。
 *
 * 门槛是 **1 分钟**：解锁瞬间那 2 秒桌面、看一眼通知就退出的 8 秒都是真数据，
 * 但一天能有上百条，列表一屏全是「09:01 - 09:01」，用户要看的分段反而被淹了。
 * 这里钉三件事：够长的留在可见列表、不够长的**折成计数**而不是丢掉、阈值本身不许漂。
 */
describe('visibleSpans / shortSpans', () => {
  it('只有 1 分钟及以上的段会出现在列表里', () => {
    const spans = [
      span(9, 0, 9, 30), // 30 分钟 —— 留
      span(9, 33, 9, 34), // 1 分钟，与上一段空 3 分钟（> 容差）—— 恰好够，留
      span(11, 0, 11, 0), // 0 秒 → 空段，merge 会丢
    ];
    const out = visibleSpans(spans);
    expect(out).toEqual([span(9, 0, 9, 30), span(9, 33, 9, 34)]);
  });

  it('59 秒的段不算「够长」—— 阈值不许写成 59 或 61', () => {
    const almost = { from: at(9, 0), to: at(9, 0) + 59_000 };
    expect(visibleSpans([almost])).toEqual([]);
    expect(shortSpans([almost])).toHaveLength(1);
  });

  it('短段不是丢掉，而是折成计数：可见 + 短段 = 全部', () => {
    const spans = [span(8, 0, 8, 10), span(9, 0, 9, 0)]; /* 第二条是 0 秒，会被 merge 丢 */
    const short = { from: at(10, 0), to: at(10, 0) + 5_000 };
    const all: UsageSpan[] = [...spans, short];
    expect(visibleSpans(all).length + shortSpans(all).length).toBe(2);
    expect(shortSpans(all)).toEqual([short]);
  });

  it('先合并再判断门槛：两段 40 秒被 10 秒空档隔开，并成 1 分 30 秒，必须留下（0.12.8）', () => {
    const a = { from: at(9, 0), to: at(9, 0) + 40_000 };
    const b = { from: at(9, 0) + 50_000, to: at(9, 0) + 90_000 };
    /* 中间 10 秒没有别的应用 ⇒ ≤1 分钟容差把它们并成一段 90 秒。
       这条用例的标题从写下那天起就是这个意图（「合起来是 1 分 30 秒，必须留下」），
       当时实现只并相接的段，先在断言里委屈成了两段短段 —— 实现补上后钉住新语义：
       合并发生在门槛判断**之前**，不许先把短段滤掉再并。 */
    expect(visibleSpans([a, b])).toEqual([{ from: at(9, 0), to: at(9, 0) + 90_000 }]);
    expect(shortSpans([a, b])).toHaveLength(0);
  });

  it('spanRawMillis 不减 1 秒兜底 —— 长度口径不许造假', () => {
    expect(spanRawMillis({ from: at(9, 0), to: at(9, 0) + 500 })).toBe(500);
  });

  it('门槛是 60 秒，不是 60 毫秒', () => {
    expect(MIN_VISIBLE_SPAN_MS).toBe(60_000);
  });
});
