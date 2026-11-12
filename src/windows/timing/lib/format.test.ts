/**
 * Timing — 格式化纯函数单测（V0.11.2）
 * -----------------------------------------------------------------------------
 * 只锁两处容易回退的边界：
 *   1. `formatRange` 跨零点：只取时分会让「23:50 → 00:20」读起来像负时长；
 *   2. `truncateName` 按码点截断：用 `slice` 会把 emoji 的代理对切一半，屏幕上出现「�」。
 */
import { describe, expect, it } from 'vitest';
import { formatRange, truncateName } from './format';

/** 本地时间构造（避免测试机时区影响断言） */
function at(day: number, hour: number, minute: number): number {
  return new Date(2026, 10, day, hour, minute, 0, 0).getTime();
}

describe('formatRange', () => {
  it('同一天：`开始 - 结束`', () => {
    expect(formatRange(at(4, 9, 12), at(4, 9, 47))).toBe('09:12 - 09:47');
  });

  it('进行中（endedAt 为空）', () => {
    expect(formatRange(at(4, 9, 12), null)).toBe('09:12 - 进行中');
  });

  it('跨零点：补「次日」，不再出现 23:50 - 00:20 这种看着像负数的写法', () => {
    expect(formatRange(at(4, 23, 50), at(5, 0, 20))).toBe('23:50 - 次日 00:20');
  });

  it('跨多天：写日期而不是「次日」', () => {
    expect(formatRange(at(4, 22, 0), at(6, 8, 5))).toBe('22:00 - 11-06 08:05');
  });
});

describe('truncateName', () => {
  it('不超长时原样返回（并去掉首尾空白）', () => {
    expect(truncateName('  写周报  ', 11)).toBe('写周报');
  });

  it('超长时保留开头并补省略号', () => {
    expect(truncateName('品牌视觉改版第一轮', 6)).toBe('品牌视觉改版…');
  });

  it('按码点截断：emoji 只会整个保留或整个丢弃，不留孤立的半个代理对', () => {
    const out = truncateName('🎨🎨🎨🎨🎨🎨', 5);
    expect(out).toBe('🎨🎨🎨🎨🎨…');
    /* 没有 U+FFFD（替换字符）就说明没切坏代理对 */
    expect(out).not.toContain('\uFFFD');
  });
});
