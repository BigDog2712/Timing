/**
 * Timing — 「已完成待办」行数据单测（V0.11.31）
 * -----------------------------------------------------------------------------
 * 钉住主人给的三条口径：
 *   1. **同事项多段合并成一行**（不论时间是否连续——这点与记录页的 `groupTodayRecords` 相反）；
 *   2. **打了勾的待办要出现**，哪怕它今天一段计时都没有；
 *   3. **计了时但没打勾** 保留并标「未勾选」——不显示的话用户会以为数据丢了。
 *
 * 再加一条实现上的坑：待办认领记录行时**先认 itemId、再认标题**。
 * 只认标题会在改名后失配；只认 itemId 会漏掉「还没开始计时就勾掉」的那种（itemId 为 null）。
 */
import { describe, expect, it } from 'vitest';
import { groupTodayDone } from './todayDone';
import type { TimeRecord, Todo } from '../types/domain';

const T0 = new Date(2026, 10, 9, 9, 0, 0, 0).getTime();
const HOUR = 3_600_000;

let seq = 0;
function rec(itemId: number, startOffsetMs: number, sec: number): TimeRecord {
  seq += 1;
  return {
    id: seq,
    itemId,
    status: 'saved',
    startedAt: T0 + startOffsetMs,
    endedAt: T0 + startOffsetMs + sec * 1000,
    accumulatedSec: sec,
    runningSince: null,
    note: null,
    mode: 'countup',
    targetSec: null,
  };
}

let todoSeq = 0;
function todo(over: Partial<Todo> & { title: string }): Todo {
  todoSeq += 1;
  return {
    id: todoSeq,
    itemId: null,
    plannedAt: null,
    remindAt: null,
    remindedAt: null,
    doneAt: null,
    sortOrder: todoSeq,
    createdAt: T0,
    updatedAt: T0,
    ...over,
  };
}

const NAMES: Record<number, string> = { 7: '写周报', 9: '改接口', 1: '未归类' };
const nameOf = (itemId: number) => NAMES[itemId] ?? `事项 ${itemId}`;

describe('按事项合并', () => {
  /** 同事项三段（中间换走过、又换回来）→ 一行、合计时长、段数 3。 */
  it('three_segments_of_one_item_become_one_row', () => {
    const rows = [rec(7, 0, 600), rec(7, HOUR, 900), rec(7, HOUR * 2, 300)];
    const out = groupTodayDone(rows, [], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ itemId: 7, name: '写周报', seconds: 1800, count: 3 });
  });

  /** 不同事项各占一行，按最后一段结束时间倒序（最近做的在最上）。 */
  it('different_items_stay_separate_and_sort_by_last_segment', () => {
    const rows = [rec(7, 0, 600), rec(9, HOUR, 300)];
    const out = groupTodayDone(rows, [], nameOf);
    expect(out.map((row) => row.itemId)).toEqual([9, 7]);
  });
});

describe('待办勾选态', () => {
  it('a_done_todo_marks_its_item_row_checked', () => {
    const rows = [rec(7, 0, 600)];
    const done = todo({ title: '写周报', itemId: 7, doneAt: T0 + HOUR });
    const out = groupTodayDone(rows, [done], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ checked: true, todoId: done.id, seconds: 600 });
  });

  /** 没打勾就是一目了然的「未勾选」，不是藏起来。 */
  it('unticked_records_are_kept_and_flagged', () => {
    const rows = [rec(7, 0, 600)];
    const out = groupTodayDone(rows, [], nameOf);
    expect(out[0]).toMatchObject({ checked: false, todoId: null });
  });

  /** 只勾了待办、一段都没计时：也要出现在「今天做完的事」里（时长 0）。 */
  it('a_done_todo_without_any_record_still_shows_up', () => {
    /* id 由夹具自增，别写死 1——写死就等于在测「夹具的计数器起点」 */
    const done = todo({ title: '交水费', doneAt: T0 + HOUR });
    const out = groupTodayDone([], [done], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      key: `todo-${done.id}`,
      name: '交水费',
      seconds: 0,
      count: 0,
      checked: true,
    });
  });

  /** 未完成的待办不进这个列表（那是待办区的活）。 */
  it('pending_todos_are_not_listed_here', () => {
    const out = groupTodayDone([], [todo({ title: '还没做的' })], nameOf);
    expect(out).toHaveLength(0);
  });
});

describe('待办认领记录行', () => {
  /**
   * 改名之后：待办标题还是旧的，但 `itemId` 绑着，必须认出是同一条。
   * 只按标题匹配时这一格会多出一行「旧标题」的幽灵。
   */
  it('item_id_wins_over_a_stale_title', () => {
    const rows = [rec(7, 0, 600)];
    const out = groupTodayDone(rows, [todo({ title: '写周报（旧名）', itemId: 7, doneAt: T0 })], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ itemId: 7, checked: true, name: '写周报' });
  });

  /** 待办没绑事项、但标题和事项名一致：按标题认领（不能凭空多一行）。 */
  it('falls_back_to_title_when_item_id_is_null', () => {
    const rows = [rec(7, 0, 600)];
    const done = todo({ title: '写周报', doneAt: T0 });
    const out = groupTodayDone(rows, [done], nameOf);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ checked: true, todoId: done.id });
  });
});
