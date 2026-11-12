/**
 * Timing — 手打时间解析（V0.3.13 / ADR-031）
 * -----------------------------------------------------------------------------
 * 用户口径「点击某一事项的开始时间，输入新的时间即可」：时间输入靠一个轻量解析器，
 * 这里钉住它接受的写法、边界（只给时刻按今天算）与报错。
 */
import { describe, expect, it } from 'vitest';
import { parseTimeInput, timeInputText } from './timeInput';

/** 2026-10-20 09:00 本地（固定基准，避免跨时区/跨毫秒抖动） */
const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime();

const at = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

describe('parseTimeInput：接受的手打写法', () => {
  it('HH:MM 按今天算', () => {
    expect(parseTimeInput('09:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 20, 9, 0) });
    expect(parseTimeInput('21:30', NOW)).toEqual({ ok: true, ms: at(2026, 10, 20, 21, 30) });
  });

  it('单位数小时 / 全角冒号与数字都能吃', () => {
    expect(parseTimeInput('9:05', NOW)).toEqual({ ok: true, ms: at(2026, 10, 20, 9, 5) });
    expect(parseTimeInput('０９：４５', NOW)).toEqual({ ok: true, ms: at(2026, 10, 20, 9, 45) });
  });

  it('相对日：明天 / 后天 / 今天', () => {
    expect(parseTimeInput('明天 09:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 21, 9, 0) });
    expect(parseTimeInput('后天 21:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 22, 21, 0) });
    expect(parseTimeInput('今天 23:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 20, 23, 0) });
    expect(parseTimeInput('明天09:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 21, 9, 0) });
  });

  it('月-日 / 带年份', () => {
    expect(parseTimeInput('10-21 09:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 21, 9, 0) });
    expect(parseTimeInput('10/21 09:00', NOW)).toEqual({ ok: true, ms: at(2026, 10, 21, 9, 0) });
    expect(parseTimeInput('2027-1-3 07:00', NOW)).toEqual({ ok: true, ms: at(2027, 1, 3, 7, 0) });
  });
});

describe('parseTimeInput：报错不猜', () => {
  it('空 / 无法识别 / 越界都给中文提示', () => {
    expect(parseTimeInput('   ', NOW).ok).toBe(false);
    expect(parseTimeInput('下午三点', NOW).ok).toBe(false);
    expect(parseTimeInput('24:00', NOW).ok).toBe(false);
    expect(parseTimeInput('10:75', NOW).ok).toBe(false);
    expect(parseTimeInput('13-01 09:00', NOW).ok).toBe(false);
    expect(parseTimeInput('2-31 09:00', NOW).ok).toBe(false);
  });
});

describe('timeInputText：回填到输入框的文本可被读回来', () => {
  it('今天只给 HH:MM，跨天带月-日', () => {
    expect(timeInputText(at(2026, 10, 20, 21, 30), NOW)).toBe('21:30');
    expect(timeInputText(at(2026, 10, 21, 9, 5), NOW)).toBe('10-21 09:05');
  });

  it('往返一致', () => {
    for (const ms of [at(2026, 10, 20, 21, 30), at(2026, 10, 21, 9, 5), at(2027, 1, 3, 7, 0)]) {
      const parsed = parseTimeInput(timeInputText(ms, NOW), NOW);
      expect(parsed).toEqual({ ok: true, ms });
    }
  });
});
