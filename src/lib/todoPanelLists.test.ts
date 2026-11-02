/**
 * TickBar — 事项窗口待办区的显示范围（ADR-034）
 * -----------------------------------------------------------------------------
 * 核心回归：**明天的 / 下周的待办必须出现在列表里**（ADR-032 时被 `filterToday` 藏掉，
 * 用户的未来计划等于凭空消失）。同时钉住已完成的取舍：只留「今天完成的」。
 */
import { describe, expect, it } from 'vitest';
import { todoPanelLists } from './todoPanelLists';
import type { Todo } from '../types/domain';

/** 2026-10-20 09:00 本地 */
const NOW = new Date(2026, 9, 20, 9, 0, 0, 0).getTime();
const at = (y: number, mo: number, d: number, h = 0, mi = 0) =>
  new Date(y, mo - 1, d, h, mi, 0, 0).getTime();

function todo(id: number, over: Partial<Todo> = {}): Todo {
  return {
    id,
    title: `待办 ${id}`,
    plannedAt: null,
    remindAt: null,
    remindedAt: null,
    doneAt: null,
    sortOrder: id,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}

const titles = (rows: Todo[]) => rows.map((t) => t.title);

describe('todoPanelLists：未完成', () => {
  it('今天 / 明天 / 下周 / 已逾期 / 未排期 全部进入待办区', () => {
    const rows = [
      todo(1, { plannedAt: at(2026, 10, 20, 18) }), // 今天
      todo(2, { plannedAt: at(2026, 10, 21, 9) }), // 明天
      todo(3, { plannedAt: at(2026, 10, 27, 9) }), // 下周
      todo(4, { plannedAt: at(2026, 10, 19, 9) }), // 已逾期
      todo(5), // 未排期
    ];
    const { pending, done } = todoPanelLists(rows, NOW);
    expect(titles(pending)).toEqual(['待办 1', '待办 2', '待办 3', '待办 4', '待办 5']);
    expect(done).toEqual([]);
  });

  it('保序（入参已是 sortOrder 升序，不再二次排序）', () => {
    const rows = [
      todo(7, { plannedAt: at(2026, 10, 25, 9) }),
      todo(8, { plannedAt: at(2026, 10, 20, 9) }),
    ];
    expect(todoPanelLists(rows, NOW).pending.map((t) => t.id)).toEqual([7, 8]);
  });
});

describe('todoPanelLists：已完成', () => {
  it('只留今天完成的；昨天完成的不进面板', () => {
    const rows = [
      todo(1, { doneAt: at(2026, 10, 20, 8, 30) }), // 今天完成
      todo(2, { doneAt: at(2026, 10, 19, 23, 59) }), // 昨天完成
    ];
    const { pending, done } = todoPanelLists(rows, NOW);
    expect(pending).toEqual([]);
    expect(titles(done)).toEqual(['待办 1']);
  });

  it('今天 00:00 整完成的算今天（自然日边界）', () => {
    const rows = [todo(1, { doneAt: at(2026, 10, 20, 0, 0) })];
    expect(todoPanelLists(rows, NOW).done.map((t) => t.id)).toEqual([1]);
  });
});
