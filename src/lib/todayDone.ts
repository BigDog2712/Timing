/**
 * Timing — 事项页「已完成待办」的行数据（纯函数）
 * -----------------------------------------------------------------------------
 * 主人原话（V0.11.31）：「记录应改为已完成待办，对同事项多段时间的，按事项合并，
 * 应不与计时界面功能重复」。
 *
 * 三句话对应三条硬规则：
 *   ① **按事项合并**：同一个事项今天计了三段（比如中途换走过又换回来），
 *      在这一页是**一行**、右边是合计时长，不是三行。原来用的是 `groupTodayRecords`，
 *      它按「事项 + 时间连续性」切段——那是计时页的口径（看一段一段的流水），
 *      在事项页会把一件事拆成好几行，正好是主人说的「功能重复」。
 *   ② **已完成待办**：今天打了勾的待办要出现在这里；哪怕它没有对应的计时记录
 *      （在电脑上点的完成、或者只是勾了一下），也算今天做完的事。
 *   ③ **不与计时页重复**：这里**没有**「开始计时」按钮，也不显示分段时刻。
 *      要计时去计时页，要看流水去记录页。
 *
 * 一个刻意的取舍：今天计了时但**没打勾**的，仍然显示，标「未勾选」。
 * 不显示的话，用户会看到「明明计了三小时，事项页一条都没有」——那比多一行更吓人。
 */

import type { Todo, TimeRecord } from '../types/domain';

export interface TodayDoneRow {
  /** 行 key：有事项用 `item-<id>`，纯待办（没绑事项）用 `todo-<id>` */
  key: string;
  /** 归属事项；null = 只是勾了一个没绑事项的待办 */
  itemId: number | null;
  name: string;
  /** 合计秒数（多段相加）；纯待办为 0 */
  seconds: number;
  /** 分了几段（>1 时界面标 ×N）；纯待办为 0 */
  count: number;
  /** 匹配到的待办 id；null = 今天没有对应待办 */
  todoId: number | null;
  /** 那条待办打完勾了没；没有待办时为 false（界面标「未勾选」） */
  checked: boolean;
  /** 排序用的时间：有记录取最后一段结束，纯待办取打勾时刻 */
  at: number;
}

/** 记录的有效结束时刻：进行中的会话用开始时刻兜底（本函数只吃已落库的行） */
function endOf(row: TimeRecord): number {
  return row.endedAt ?? row.startedAt;
}

/**
 * 把今天的记录 + 今天的待办折成「已完成待办」的行。
 *
 * @param rows 今天（或所看区间）的记录，通常来自 `useTodayRecords().rows`
 * @param todos 待办全表（`useTodoStore().todos`，含已完成）
 * @param nameOf 事项名解析（事项被删了也要有个说法，交给调用方的 `itemName`）
 */
export function groupTodayDone(
  rows: readonly TimeRecord[],
  todos: readonly Todo[],
  nameOf: (itemId: number) => string,
): TodayDoneRow[] {
  const byItem = new Map<number, TodayDoneRow>();

  for (const row of rows) {
    const hit = byItem.get(row.itemId);
    if (hit) {
      hit.seconds += row.accumulatedSec;
      hit.count += 1;
      hit.at = Math.max(hit.at, endOf(row));
    } else {
      byItem.set(row.itemId, {
        key: `item-${row.itemId}`,
        itemId: row.itemId,
        name: nameOf(row.itemId),
        seconds: row.accumulatedSec,
        count: 1,
        todoId: null,
        checked: false,
        at: endOf(row),
      });
    }
  }

  /* 待办 → 记录行：**先认 itemId，再认标题**。
     只认标题会在「改名之后」失配（待办留下的是旧标题）；
     只认 itemId 会漏掉「还没开始过计时就勾掉」的那种（itemId 仍是 null）。 */
  const leftovers: TodayDoneRow[] = [];
  for (const todo of todos) {
    if (todo.doneAt == null) continue; // 没完成的待办不属于「已完成」
    const hit =
      (todo.itemId != null ? byItem.get(todo.itemId) : undefined) ??
      [...byItem.values()].find((row) => row.name === todo.title);
    if (hit) {
      hit.todoId = todo.id;
      hit.checked = true;
      continue;
    }
    leftovers.push({
      key: `todo-${todo.id}`,
      itemId: todo.itemId,
      name: todo.title,
      seconds: 0,
      count: 0,
      todoId: todo.id,
      checked: true,
      at: todo.doneAt,
    });
  }

  /* 倒序：最近做的在最上面。纯待办与有记录的行混排——都是「今天做完的事」，
     分两个区块反而要用户自己对齐时间。 */
  return [...byItem.values(), ...leftovers].sort((a, b) => b.at - a.at);
}
