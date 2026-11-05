/**
 * Timing — 「退出期间」换算单测（V0.4.2）
 * 口径必须与后端 `services::timer::gap_sec` 一致：暂停中不补、负数不补、不足 1 分钟不问。
 */
import { describe, expect, it } from 'vitest';
import { RECOVER_GAP_MIN_SEC, recoverGapSec, shouldAskGap } from './recoverGap';
import type { TimeRecord } from '../types/domain';

const base: TimeRecord = {
  id: 1,
  itemId: 1,
  status: 'active',
  startedAt: 1_000_000,
  endedAt: null,
  accumulatedSec: 42,
  runningSince: 1_000_000,
  note: null,
  mode: 'countup',
  targetSec: null,
};

describe('recoverGapSec', () => {
  it('计时中崩溃：空档 = 现在 - runningSince', () => {
    expect(recoverGapSec({ ...base, runningSince: 1_000_000 }, 1_000_000 + 600_000)).toBe(600);
  });

  it('暂停中崩溃：没有流逝，不产生空档', () => {
    expect(recoverGapSec({ ...base, runningSince: null }, 9_999_999)).toBe(0);
  });

  it('墙钟回拨（now 早于 runningSince）时给 0，不出现负数', () => {
    expect(recoverGapSec({ ...base, runningSince: 2_000_000 }, 1_000_000)).toBe(0);
  });

  it('向下取整到秒', () => {
    expect(recoverGapSec({ ...base, runningSince: 0 }, 1_999)).toBe(1);
    expect(recoverGapSec({ ...base, runningSince: 0 }, 1_000)).toBe(1);
  });
});

describe('shouldAskGap', () => {
  it('不足 1 分钟不问', () => {
    expect(shouldAskGap(0)).toBe(false);
    expect(shouldAskGap(RECOVER_GAP_MIN_SEC - 1)).toBe(false);
  });

  it('达到 1 分钟才问', () => {
    expect(shouldAskGap(RECOVER_GAP_MIN_SEC)).toBe(true);
    expect(shouldAskGap(3600)).toBe(true);
  });
});
