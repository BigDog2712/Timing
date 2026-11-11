/**
 * Timing — 宿主侧「今天」日期口径的单测（P0-03）
 * -----------------------------------------------------------------------------
 * 钉死三件会静默出错的事：
 *  ① 补零（`2026-01-05` 不是 `2026-1-5`）；
 *  ② 取**本地**日历日的分量，不是 UTC 截断（后半段的两个用例在任何时区都成立，
 *     而 `toISOString().slice(0,10)` 在非 UTC 时区至少有一个会失败）；
 *  ③ 一天里的任意时刻都落在同一个 key 上（00:00 与 23:59 同一天）。
 *
 * 不跨窗 import 分析窗那份实现：L9 把 `src/lib`（主窗）与 `src/shared`（分析窗）
 * 判为不可互相 import，测试文件也在扫描范围内。
 */
import { describe, expect, it } from 'vitest';
import { formatLocalDateKey, pad2, todayDateKey } from './dateKey';

describe('pad2', () => {
  it('一位数补前导零，两位数不动', () => {
    expect(pad2(0)).toBe('00');
    expect(pad2(9)).toBe('09');
    expect(pad2(10)).toBe('10');
    expect(pad2(2026).slice(-2)).toBe('26');
  });
});

describe('formatLocalDateKey', () => {
  it('按本地年月日拼出补零的 YYYY-MM-DD', () => {
    expect(formatLocalDateKey(new Date(2026, 0, 5))).toBe('2026-01-05');
    expect(formatLocalDateKey(new Date(2026, 11, 31))).toBe('2026-12-31');
    expect(formatLocalDateKey(new Date(2026, 9, 9, 13, 45))).toBe('2026-10-09');
  });

  it('同一天的不同时刻得到同一个 key（不受时钟时间影响）', () => {
    const start = new Date(2026, 5, 30, 0, 0, 0);
    const end = new Date(2026, 5, 30, 23, 59, 59, 999);
    expect(formatLocalDateKey(start)).toBe('2026-06-30');
    expect(formatLocalDateKey(end)).toBe('2026-06-30');
  });

  it('不按 UTC 截断：本地 00:30 与 23:30 都留在本地当天', () => {
    /* 这两条在任何时区都成立；若实现改成 toISOString().slice(0,10)，
       非 UTC 时区至少有一条会跨到前一天/后一天。 */
    expect(formatLocalDateKey(new Date(2026, 0, 1, 0, 30))).toBe('2026-01-01');
    expect(formatLocalDateKey(new Date(2026, 11, 31, 23, 30))).toBe('2026-12-31');
  });
});

describe('todayDateKey', () => {
  it('默认取当前时刻，与 formatLocalDateKey(new Date()) 同口径', () => {
    expect(todayDateKey()).toBe(formatLocalDateKey(new Date()));
  });

  it('注入时刻时完全由该时刻决定', () => {
    expect(todayDateKey(new Date(2026, 2, 1, 8, 5))).toBe('2026-03-01');
  });
});
