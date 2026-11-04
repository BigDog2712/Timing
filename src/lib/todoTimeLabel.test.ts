/**
 * Timing — 待办行时间列文案（ADR-034）
 * -----------------------------------------------------------------------------
 * 口径：「在右侧显示逾期；对于未来的任务，显示日期」。这里把五种文案钉死：
 *   ① 无时间 → 留白（title 也没有）     ② 逾期 → `逾期`
 *   ③ 明天 / 下周 → `MM-DD`             ④ 今天 → `HH:MM`
 *   ⑤ 跨年 → `YY-MM-DD`                 ⑥ 已完成不出现「逾期」
 *   ⑦ 只设 `remind_at` 且已过 → 不算逾期（`remind_at` 不是截止承诺）
 * 外加：`title` 恒为完整时间（`YYYY-MM-DD HH:MM`），把缩写掉的信息兜住。
 */
import { describe, expect, it } from 'vitest';
import { isTodoOverdue, todoTimeLabel } from './todoTimeLabel';
import type { Todo } from '../types/domain';

/** 2026-10-20 09:00 本地（周二） */
const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime();
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

function todo(over: Partial<Todo> = {}): Todo {
  return {
    id: 1,
    title: '写周报',
    plannedAt: null,
    remindAt: null,
    remindedAt: null,
    doneAt: null,
    sortOrder: 1,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

describe('todoTimeLabel：两种时间都没设', () => {
  it('留白，并且不带 title（ADR-028 §7）', () => {
    expect(todoTimeLabel(todo(), NOW)).toEqual({ text: '', title: null });
  });
});

describe('todoTimeLabel：未完成', () => {
  it('截止已过 → 逾期，title 是逾期基准的完整时间', () => {
    const label = todoTimeLabel(todo({ plannedAt: at(2026, 10, 19, 18, 30) }), NOW);
    expect(label.text).toBe('逾期');
    expect(label.title).toBe('2026-10-19 18:30');
  });

  it('明天 → MM-DD', () => {
    const label = todoTimeLabel(todo({ plannedAt: at(2026, 10, 21, 9) }), NOW);
    expect(label.text).toBe('10-21');
    expect(label.title).toBe('2026-10-21 09:00');
  });

  it('下周 → MM-DD（不写星期、不写「N 天后」）', () => {
    const label = todoTimeLabel(todo({ plannedAt: at(2026, 10, 27, 14, 5) }), NOW);
    expect(label.text).toBe('10-27');
    expect(label.title).toBe('2026-10-27 14:05');
  });

  it('今天 → HH:MM（与「今日计时」行同一套读数）', () => {
    const label = todoTimeLabel(todo({ plannedAt: at(2026, 10, 20, 21, 30) }), NOW);
    expect(label.text).toBe('21:30');
    expect(label.title).toBe('2026-10-20 21:30');
  });

  it('跨年 → YY-MM-DD（只写 01-05 会分不清是哪一年）', () => {
    const label = todoTimeLabel(todo({ plannedAt: at(2027, 1, 5, 9) }), NOW);
    expect(label.text).toBe('27-01-05');
    expect(label.title).toBe('2027-01-05 09:00');
  });

  it('明天 00:00 算「明天」（自然日边界）', () => {
    expect(todoTimeLabel(todo({ plannedAt: at(2026, 10, 21, 0, 0) }), NOW).text).toBe('10-21');
    expect(todoTimeLabel(todo({ plannedAt: at(2026, 10, 20, 23, 59) }), NOW).text).toBe('23:59');
  });

  it('开始时间优先：remind_at 在今天、截止在明天 → 显示今天的 HH:MM', () => {
    const label = todoTimeLabel(
      todo({ remindAt: at(2026, 10, 20, 16), plannedAt: at(2026, 10, 21, 9) }),
      NOW,
    );
    expect(label.text).toBe('16:00');
  });

  it('只设 remind_at 且已过 → 不算逾期：同一天写 HH:MM，跨天写日期', () => {
    const today = todo({ remindAt: at(2026, 10, 20, 8) });
    expect(isTodoOverdue(today, NOW)).toBe(false);
    expect(todoTimeLabel(today, NOW).text).toBe('08:00');

    const yesterday = todo({ remindAt: at(2026, 10, 19, 8) });
    expect(isTodoOverdue(yesterday, NOW)).toBe(false);
    expect(todoTimeLabel(yesterday, NOW).text).toBe('10-19');
  });

  it('未排期（两项都空）不会被判逾期', () => {
    expect(isTodoOverdue(todo(), NOW)).toBe(false);
  });
});

describe('todoTimeLabel：已完成', () => {
  it('今天完成 → HH:MM，且不出现「逾期」', () => {
    const label = todoTimeLabel(
      todo({ plannedAt: at(2026, 10, 20, 9), doneAt: at(2026, 10, 20, 10) }),
      NOW,
    );
    expect(label.text).toBe('09:00');
    expect(label.text).not.toBe('逾期');
  });

  it('截止在昨天、今天才完成 → 不出现「逾期」，写日期（目标不在完成日）', () => {
    const done = todo({ plannedAt: at(2026, 10, 19, 18), doneAt: at(2026, 10, 20, 8, 30) });
    expect(isTodoOverdue(done, NOW)).toBe(false);
    expect(todoTimeLabel(done, NOW).text).toBe('10-19');
  });

  it('非今天完成（防御分支）→ 日期而不是 HH:MM', () => {
    const label = todoTimeLabel(
      todo({ plannedAt: at(2026, 10, 20, 9), doneAt: at(2026, 10, 18, 20) }),
      NOW,
    );
    expect(label.text).toBe('10-20');
    expect(label.title).toBe('2026-10-20 09:00');
  });
});
