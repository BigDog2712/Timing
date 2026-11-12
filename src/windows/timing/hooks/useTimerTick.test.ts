/**
 * 时间口径黄金用例（R8）——与 Rust 侧 `tests/timer_formula.rs` 读同一份 fixture。
 *
 * 为什么值得单独写：计时读数是这个产品的核心输出，而它有三处实现
 * （Rust `live_duration` / `useTimerTick.computeLiveSec` / `PillBar` 的剩余时长）。
 * 用同一张表钉死边界，任何一端改公式都会红——这是唯一能防「三处口径悄悄漂移」的办法。
 */
import { describe, expect, it, vi } from 'vitest';
import fixture from '../../../../tests/fixtures/timer-formula.json';
import { computeLiveSec } from './useTimerTick';
import type { TimeRecord } from '../types/domain';

interface Case {
  name: string;
  accumulatedSec: number;
  deltaMs: number | null;
  expect: number;
}

function session(c: Case): TimeRecord {
  const runningSince = c.deltaMs == null ? null : 1_700_000_000_000;
  return {
    id: 1,
    itemId: 1,
    status: 'active',
    startedAt: 1_700_000_000_000,
    endedAt: null,
    accumulatedSec: c.accumulatedSec,
    runningSince,
    note: null,
    mode: 'countup',
    targetSec: null,
  };
}

describe('computeLiveSec — 与 Rust 同口径', () => {
  for (const c of fixture.cases as Case[]) {
    it(`${c.name}（累计 ${c.accumulatedSec}s，Δ${c.deltaMs ?? '暂停'}ms）`, () => {
      const rec = session(c);
      if (c.deltaMs != null && rec.runningSince != null) {
        vi.spyOn(Date, 'now').mockReturnValue(rec.runningSince + c.deltaMs);
      }
      expect(computeLiveSec(rec)).toBe(c.expect);
      vi.restoreAllMocks();
    });
  }

  it('idle（无会话）为 0', () => {
    expect(computeLiveSec(null)).toBe(0);
  });
});
