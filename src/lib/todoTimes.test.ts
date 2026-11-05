/**
 * Timing — 待办时间改写单测（V0.3.10）
 * -----------------------------------------------------------------------------
 * 钉住三件事：
 *   1. 两项时间**可空置**：`null` 是合法输入，而且要真的出现在 patch 里
 *      （前端的「清除」靠它落到 SQL NULL；省略字段 = 不改）。
 *   2. `remind` / `planned` 各自只改自己那一项，不误伤另一项。
 *   3. 「截止不能早于开启」只在两侧都有值时比较 —— 只设一项永远合法。
 */
import { describe, expect, it } from 'vitest';
import { todoTimePatch } from './todoTimes';

const HOUR = 3_600_000;
const T0 = 1_700_000_000_000;

const both = { remindAt: T0, plannedAt: T0 + 2 * HOUR };
const none = { remindAt: null, plannedAt: null };

describe('todoTimePatch', () => {
  it('改开启时间：只带 remindAt，不碰截止', () => {
    const r = todoTimePatch(both, 'remind', T0 + HOUR);
    expect(r).toEqual({ ok: true, patch: { remindAt: T0 + HOUR } });
  });

  it('改截止时间：只带 plannedAt，不碰开启', () => {
    const r = todoTimePatch(both, 'planned', T0 + 3 * HOUR);
    expect(r).toEqual({ ok: true, patch: { plannedAt: T0 + 3 * HOUR } });
  });

  it('清空某一项：patch 显式带 null（= 后端落 NULL，不是「不改」）', () => {
    expect(todoTimePatch(both, 'remind', null)).toEqual({ ok: true, patch: { remindAt: null } });
    expect(todoTimePatch(both, 'planned', null)).toEqual({ ok: true, patch: { plannedAt: null } });
  });

  it('两项都空时随便设哪一项都不算越界（可空置口径）', () => {
    expect(todoTimePatch(none, 'planned', T0).ok).toBe(true);
    expect(todoTimePatch(none, 'remind', T0).ok).toBe(true);
  });

  it('截止早于开启 → 拒绝并给同一句文案（与新增卡一致）', () => {
    expect(todoTimePatch(both, 'planned', T0 - HOUR)).toEqual({
      ok: false,
      error: '截止时间不能早于开启时间',
    });
    expect(todoTimePatch(both, 'remind', T0 + 5 * HOUR)).toEqual({
      ok: false,
      error: '截止时间不能早于开启时间',
    });
  });

  it('相等时刻合法（同一分钟内开启即截止）', () => {
    expect(todoTimePatch(both, 'planned', T0)).toEqual({ ok: true, patch: { plannedAt: T0 } });
  });

  it('非有限数不落库', () => {
    expect(todoTimePatch(none, 'planned', Number.NaN)).toEqual({
      ok: false,
      error: '时间无效，请重新选择',
    });
  });
});
