/**
 * datetime.ts / pickerBox.ts 单测（V0.3.9）
 * 覆盖四条口径：默认今天（`defaultPickerValue` / `ceilToStep`）、「x 天后」、
 * 上午下午换算、5 分钟档位，以及浮层的贴边逻辑。
 */
import { describe, expect, it } from 'vitest';
import {
  MINUTE_SLOTS,
  ceilToStep,
  dayDiff,
  defaultPickerValue,
  formatFieldLabel,
  isSameDay,
  monthGrid,
  relativeDayLabel,
  shiftMonth,
  to12h,
  to24h,
  withTimeOfDay,
} from './datetime';
import { pickerBox } from './pickerBox';

/** 本地时区构造（与实现同一口径，避免测试受 TZ 影响） */
const at = (y: number, m: number, d: number, h = 0, mi = 0) => new Date(y, m - 1, d, h, mi, 0, 0).getTime();

describe('ceilToStep / defaultPickerValue', () => {
  it('向上取到下一个 5 分钟档', () => {
    expect(ceilToStep(at(2026, 10, 19, 21, 32))).toBe(at(2026, 10, 19, 21, 35));
    expect(ceilToStep(at(2026, 10, 19, 21, 58))).toBe(at(2026, 10, 19, 22, 0));
    expect(ceilToStep(at(2026, 10, 19, 23, 59))).toBe(at(2026, 10, 20, 0, 0));
  });

  it('已在档位上则不变（秒归零）', () => {
    expect(ceilToStep(at(2026, 10, 19, 21, 35))).toBe(at(2026, 10, 19, 21, 35));
  });

  it('默认值仍是「今天」', () => {
    const now = at(2026, 10, 19, 14, 3);
    const v = defaultPickerValue(now);
    expect(isSameDay(v, now)).toBe(true);
    expect(v).toBe(at(2026, 10, 19, 14, 5));
  });
});

describe('相对天数与读数', () => {
  const now = at(2026, 10, 19, 10, 0);

  it('dayDiff 按日历日算，忽略时分', () => {
    expect(dayDiff(now, at(2026, 10, 19, 23, 59))).toBe(0);
    expect(dayDiff(now, at(2026, 10, 22, 1, 0))).toBe(3);
    expect(dayDiff(now, at(2026, 10, 18, 23, 0))).toBe(-1);
  });

  it('「x 天后」文案', () => {
    expect(relativeDayLabel(at(2026, 10, 19, 23, 0), now)).toBe('今天');
    expect(relativeDayLabel(at(2026, 10, 20, 0, 5), now)).toBe('1 天后');
    expect(relativeDayLabel(at(2026, 10, 22, 9, 0), now)).toBe('3 天后');
    expect(relativeDayLabel(at(2026, 10, 17, 9, 0), now)).toBe('2 天前');
  });

  it('字段读数：今天 / 明天 / 昨天 / 月日 / 跨年', () => {
    expect(formatFieldLabel(at(2026, 10, 19, 21, 30), now)).toBe('今天 21:30');
    expect(formatFieldLabel(at(2026, 10, 20, 9, 5), now)).toBe('明天 09:05');
    expect(formatFieldLabel(at(2026, 10, 18, 8, 0), now)).toBe('昨天 08:00');
    expect(formatFieldLabel(at(2026, 12, 3, 7, 0), now)).toBe('12月3日 07:00');
    expect(formatFieldLabel(at(2027, 1, 3, 7, 0), now)).toBe('2027年1月3日 07:00');
    expect(formatFieldLabel(null, now)).toBe('');
  });
});

describe('上午 / 下午换算', () => {
  it('24 → 12 小时制（0 点与 12 点都是 12）', () => {
    expect(to12h(0)).toEqual({ meridiem: 'am', hour12: 12 });
    expect(to12h(9)).toEqual({ meridiem: 'am', hour12: 9 });
    expect(to12h(12)).toEqual({ meridiem: 'pm', hour12: 12 });
    expect(to12h(21)).toEqual({ meridiem: 'pm', hour12: 9 });
  });

  it('12 → 24 小时制', () => {
    expect(to24h('am', 12)).toBe(0);
    expect(to24h('am', 9)).toBe(9);
    expect(to24h('pm', 12)).toBe(12);
    expect(to24h('pm', 9)).toBe(21);
  });

  it('12 小时制往返不丢', () => {
    for (let h = 0; h < 24; h += 1) {
      const { meridiem, hour12 } = to12h(h);
      expect(to24h(meridiem, hour12)).toBe(h);
    }
  });
});

describe('分钟档位与组合', () => {
  it('每 5 分钟一档，共 12 档', () => {
    expect(MINUTE_SLOTS).toHaveLength(12);
    expect(MINUTE_SLOTS[0]).toBe(0);
    expect(MINUTE_SLOTS[11]).toBe(55);
  });

  it('withTimeOfDay 只换时分、不动日期', () => {
    const out = withTimeOfDay(at(2026, 10, 22, 3, 4), 21, 30);
    expect(out).toBe(at(2026, 10, 22, 21, 30));
  });
});

describe('monthGrid / shiftMonth', () => {
  it('2026-10 是 5 行 35 格，周一起首', () => {
    const cells = monthGrid(2026, 9);
    expect(cells).toHaveLength(35);
    expect(cells[0].date).toBe(28);
    expect(cells[0].inMonth).toBe(false);
    expect(cells[3].date).toBe(1);
    expect(cells[3].inMonth).toBe(true);
    expect(cells[33].date).toBe(31);
    expect(cells[34].date).toBe(1);
    expect(cells[34].inMonth).toBe(false);
  });

  it('跨年翻月', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month: 11 });
  });
});

describe('pickerBox', () => {
  const anchor = { top: 300, bottom: 328, right: 484, width: 234 };

  it('下方放不下 → 翻到上方，横向右对齐卡片', () => {
    const box = pickerBox(anchor, 492, 560, 268);
    expect(box.top).toBe(26);
    /* 宽度取卡片宽（234），右沿贴 492-8 */
    expect(box.width).toBe(234);
    expect(box.left).toBe(492 - 8 - 234);
  });

  it('下方有空间就贴在字段下方', () => {
    const box = pickerBox({ ...anchor, top: 100, bottom: 128 }, 492, 560, 268);
    expect(box.top).toBe(134);
  });

  it('窄视口：宽度收窄并夹在边距内', () => {
    const box = pickerBox(anchor, 200, 400, 268);
    expect(box.width).toBe(184);
    expect(box.left).toBe(8);
    expect(box.maxHeight).toBeGreaterThan(0);
  });
});
