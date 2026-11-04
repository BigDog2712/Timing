import { describe, expect, it } from 'vitest';
import {
  itemTimerMinutes,
  movedList,
  normalizeItemTimers,
  withItemTimer,
} from './commonItems';

describe('normalizeItemTimers', () => {
  it('丢弃非法 id 与越界时长，保留合法整数', () => {
    const out = normalizeItemTimers({
      '2': 25,
      '3': 0,
      '0': 10,
      '-1': 10,
      abc: 10,
      '4': 9999,
      '5': 1440,
    });
    expect(out).toEqual({ '2': 25, '5': 1440 });
  });

  it('空值与 null 都返回空表', () => {
    expect(normalizeItemTimers(null)).toEqual({});
    expect(normalizeItemTimers(undefined)).toEqual({});
    expect(normalizeItemTimers({})).toEqual({});
  });

  it('小数四舍五入到分钟', () => {
    expect(normalizeItemTimers({ '7': 12.6 })).toEqual({ '7': 13 });
  });
});

describe('itemTimerMinutes', () => {
  it('未设置返回 null，设置了返回分钟数', () => {
    expect(itemTimerMinutes({}, 9)).toBeNull();
    expect(itemTimerMinutes({ '9': 30 }, 9)).toBe(30);
  });
});

describe('withItemTimer', () => {
  it('写入与清除都走归一化', () => {
    const withTwo = withItemTimer({}, 2, 45);
    expect(withTwo).toEqual({ '2': 45 });

    const cleared = withItemTimer(withTwo, 2, null);
    expect(cleared).toEqual({});

    // 越界值会被钳掉（归一化后为空 → 视为未设置）
    expect(withItemTimer({}, 3, 0)).toEqual({});
  });
});

describe('movedList', () => {
  it('把元素挪到目标位置，不改原数组', () => {
    const src = ['a', 'b', 'c'];
    expect(movedList(src, 0, 2)).toEqual(['b', 'c', 'a']);
    expect(movedList(src, 2, 0)).toEqual(['c', 'a', 'b']);
    expect(src).toEqual(['a', 'b', 'c']);
  });

  it('同位置与越界原样返回', () => {
    expect(movedList(['a', 'b'], 1, 1)).toEqual(['a', 'b']);
    expect(movedList(['a', 'b'], -1, 1)).toEqual(['a', 'b']);
    expect(movedList(['a', 'b'], 0, 5)).toEqual(['a', 'b']);
  });
});
