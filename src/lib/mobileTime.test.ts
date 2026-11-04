/**
 * TickBar — 移动端时间输入换算（V0.4.1）
 * -----------------------------------------------------------------------------
 * `<input type="datetime-local">` 的值是无时区后缀的本地字符串、后端一律 epoch ms。
 * 这里钉住三件事：①往返一致（拼错一位就是把记录挪到 8 小时外）；
 * ②界面只编辑到分钟，秒必须被丢弃；③非法输入返回 null，绝不把 NaN 写进记录。
 */
import { describe, expect, it } from 'vitest';
import { fromDateTimeInput, minutesToSec, toDateTimeInput } from './mobileTime';

/** 本地时间 → epoch ms（月份从 1 开始，秒/毫秒默认 0，避免抖动） */
const at = (y: number, mo: number, d: number, h: number, mi = 0, s = 0, ms = 0) =>
  new Date(y, mo - 1, d, h, mi, s, ms).getTime();

describe('toDateTimeInput：epoch ms → 输入框字符串', () => {
  it('补零到两位，月份从 1 开始', () => {
    expect(toDateTimeInput(at(2026, 1, 5, 9, 3))).toBe('2026-01-05T09:03');
    expect(toDateTimeInput(at(2026, 10, 20, 21, 30))).toBe('2026-10-20T21:30');
    expect(toDateTimeInput(at(2026, 12, 31, 23, 59))).toBe('2026-12-31T23:59');
  });

  it('秒与毫秒被截断（界面只编辑到分钟）', () => {
    expect(toDateTimeInput(at(2026, 10, 20, 9, 18, 42, 987))).toBe('2026-10-20T09:18');
    expect(toDateTimeInput(at(2026, 10, 20, 9, 18, 59, 999))).toBe('2026-10-20T09:18');
  });

  it('午夜与跨年边界', () => {
    expect(toDateTimeInput(at(2026, 1, 1, 0, 0))).toBe('2026-01-01T00:00');
    expect(toDateTimeInput(at(2027, 1, 1, 0, 0))).toBe('2027-01-01T00:00');
  });
});

describe('fromDateTimeInput：输入框字符串 → epoch ms', () => {
  it('按本地时区解析，与 new Date(y, m, d, h, mi) 一致', () => {
    expect(fromDateTimeInput('2026-10-20T21:30')).toBe(at(2026, 10, 20, 21, 30));
    expect(fromDateTimeInput('2026-01-05T09:03')).toBe(at(2026, 1, 5, 9, 3));
  });

  it('首尾空白被裁掉', () => {
    expect(fromDateTimeInput('  2026-10-20T21:30  ')).toBe(at(2026, 10, 20, 21, 30));
  });

  it('空 / 无法识别 / 越界一律返回 null，绝不返回 NaN', () => {
    for (const bad of ['', '   ', 'abc', '2026-13-45T99:99', '2026-10-20T', 'T21:30']) {
      const out = fromDateTimeInput(bad);
      expect(out).toBeNull();
      expect(Number.isNaN(out as number)).toBe(false);
    }
  });
});

describe('往返一致', () => {
  it('toDateTimeInput → fromDateTimeInput 回到原值（含跨月、跨年）', () => {
    const samples = [
      at(2026, 10, 20, 21, 30),
      at(2026, 1, 1, 0, 0),
      at(2026, 12, 31, 23, 59),
      at(2027, 1, 1, 0, 0),
      at(2026, 2, 28, 9, 18),
      at(2028, 2, 29, 14, 35), // 闰日
      at(2026, 6, 30, 12, 0),
    ];
    for (const ms of samples) {
      expect(fromDateTimeInput(toDateTimeInput(ms))).toBe(ms);
    }
  });

  it('带秒的 ms 往返后秒被清零（差值不超过 59 秒）', () => {
    const ms = at(2026, 10, 20, 9, 18, 42, 987);
    const back = fromDateTimeInput(toDateTimeInput(ms));
    expect(back).toBe(at(2026, 10, 20, 9, 18));
    expect(ms - (back as number)).toBe(42_987);
  });
});

describe('minutesToSec：分钟 → 秒', () => {
  it('整数分钟直接乘 60', () => {
    expect(minutesToSec(0)).toBe(0);
    expect(minutesToSec(1)).toBe(60);
    expect(minutesToSec(25)).toBe(1_500);
    expect(minutesToSec(1_440)).toBe(86_400);
  });

  it('四舍五入到整秒（.5 进位）', () => {
    expect(minutesToSec(0.5)).toBe(30);
    expect(minutesToSec(1.5)).toBe(90);
    expect(minutesToSec(0.999)).toBe(60); // 59.94 → 60
    expect(minutesToSec(1.008)).toBe(60); // 60.48 → 60
    expect(minutesToSec(1.009)).toBe(61); // 60.54 → 61
    expect(minutesToSec(0.001)).toBe(0); // 0.06 → 0
  });

  it('负数按远离零方向四舍五入（不会被误当合法时长使用）', () => {
    expect(minutesToSec(-0.5)).toBe(-30);
    expect(minutesToSec(-1.5)).toBe(-90);
  });

  it('结果始终是整数，没有浮点尾巴', () => {
    for (const m of [0.1, 0.3, 7.7, 12.6, 33.33]) {
      expect(Number.isInteger(minutesToSec(m))).toBe(true);
    }
  });
});
