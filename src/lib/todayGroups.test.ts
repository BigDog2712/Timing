/**
 * Timing — 「今日计时」分组单测（ADR-021 + V0.4.2 连续性切分）
 * -----------------------------------------------------------------------------
 * 钉住三条口径：
 *   1. 同一条事项**时间连续**（间隔 ≤ 60s）的记录并成一行，时长求和；
 *   2. 同一条事项**时间不连续**时分行 —— 用户口径「同一事项若时间不连续，则分行记录」；
 *   3. 同名但属于**不同事项**时不合并 —— ADR-021 允许同名之后必须成立的行为。
 */
import { describe, expect, it } from 'vitest';
import { CONTIGUOUS_GAP_MS, groupTodayRecords } from './todayGroups';
import type { TimeRecord } from '../types/domain';

const MIN = 60_000;

let seq = 0;
function rec(itemId: number, startedAt: number, accumulatedSec: number, endedAt: number | null = null): TimeRecord {
  seq += 1;
  return {
    id: seq,
    itemId,
    status: 'saved',
    startedAt,
    endedAt,
    accumulatedSec,
    runningSince: null,
    note: null,
    mode: 'countup',
    targetSec: null,
  };
}

const names: Record<number, string> = { 1: '开会', 2: '开会', 3: '写码' };
const nameOf = (id: number) => names[id] ?? '已删除事项';

describe('groupTodayRecords', () => {
  it('时间连续（背靠背）的多条记录并成一行，累计时长求和', () => {
    const groups = groupTodayRecords([rec(1, 1000, 60, 2000), rec(1, 3000, 30, 4000)], nameOf);
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ itemId: 1, name: '开会', startedAt: 1000, endedAt: 4000, seconds: 90, count: 2 });
  });

  it('间隔正好等于阈值仍算连续', () => {
    const start = Date.UTC(2026, 9, 21, 9, 0, 0);
    const groups = groupTodayRecords(
      [rec(1, start, 600, start + 10 * MIN), rec(1, start + 10 * MIN + CONTIGUOUS_GAP_MS, 60, start + 11 * MIN)],
      nameOf,
    );
    expect(groups).toHaveLength(1);
    expect(groups[0].count).toBe(2);
  });

  it('超过阈值 = 时间不连续，拆成两行（上午 / 下午各一段）', () => {
    const start = Date.UTC(2026, 9, 21, 9, 0, 0);
    const groups = groupTodayRecords(
      [
        rec(1, start, 1800, start + 30 * MIN), // 09:00–09:30
        rec(1, start + 5 * 60 * MIN, 900, start + 5 * 60 * MIN + 15 * MIN), // 14:00–14:15
      ],
      nameOf,
    );
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({ startedAt: start, endedAt: start + 30 * MIN, seconds: 1800, count: 1 });
    expect(groups[1]).toMatchObject({ seconds: 900, count: 1 });
    /* 行 key 必须唯一，否则 React 会把两行当成同一行、右键只作用于其中一行 */
    expect(new Set(groups.map((g) => g.key)).size).toBe(2);
  });

  it('三段里只有前两段连续时，第三段单独一行', () => {
    const t = Date.UTC(2026, 9, 21, 9, 0, 0);
    const groups = groupTodayRecords(
      [
        rec(3, t, 600, t + 10 * MIN),
        rec(3, t + 10 * MIN, 300, t + 15 * MIN),
        rec(3, t + 120 * MIN, 120, t + 122 * MIN),
      ],
      nameOf,
    );
    expect(groups.map((g) => g.count)).toEqual([2, 1]);
    expect(groups[0].seconds).toBe(900);
    expect(groups[1].seconds).toBe(120);
  });

  it('同名但不同事项拆成两行（ADR-021 允许同名）', () => {
    const groups = groupTodayRecords([rec(1, 1000, 60, 2000), rec(2, 500, 10, 900)], nameOf);
    expect(groups.map((g) => g.itemId)).toEqual([2, 1]);
    expect(groups.map((g) => g.name)).toEqual(['开会', '开会']);
    expect(groups.map((g) => g.seconds)).toEqual([10, 60]);
  });

  it('按开始时间升序，跨事项也保持时间线顺序', () => {
    const groups = groupTodayRecords([rec(3, 5_000_000, 5, 5_100_000), rec(1, 1000, 5, 2000), rec(2, 3_000_000, 5, 3_100_000)], nameOf);
    expect(groups.map((g) => g.startedAt)).toEqual([1000, 3_000_000, 5_000_000]);
  });

  it('上一条没有结束时间时无法判断连续，另起一行', () => {
    const groups = groupTodayRecords([rec(1, 1000, 5), rec(1, 2000, 5)], nameOf);
    expect(groups).toHaveLength(2);
    expect(groups[0].endedAt).toBeNull();
  });

  it('只有部分记录有结束时间时取有值的最晚那个（连续段内）', () => {
    const [g] = groupTodayRecords([rec(1, 1000, 5, 1500), rec(1, 2000, 5), rec(1, 3000, 5, 3500)], nameOf);
    expect(g.endedAt).toBe(3500);
    expect(g.count).toBe(3);
  });

  it('查不到名字时用兜底文案，且不同事项各占一行', () => {
    const groups = groupTodayRecords([rec(9, 1000, 5), rec(8, 2000, 5)], nameOf);
    expect(groups.map((g) => g.name)).toEqual(['已删除事项', '已删除事项']);
    expect(groups.map((g) => g.itemId)).toEqual([9, 8]);
  });

  it('空输入返回空数组', () => {
    expect(groupTodayRecords([], nameOf)).toEqual([]);
  });
});
