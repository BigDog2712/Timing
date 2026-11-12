/**
 * Timing — 事项窗口「待办事项」区显示哪些待办（ADR-034）
 * -----------------------------------------------------------------------------
 * 用户口径（同 ADR-034）：待办区显示「未完成的全部」（今天 + 以后 + 已逾期 + 未排期），
 * 右侧时间列用「逾期 / 日期」区分它们（文案规则见 `lib/todoTimeLabel.ts`）。
 *
 * ADR-032 时的 `filterToday` 已删除：它把明天的、下周的待办**整条藏起来**，
 * 于是「我设了未来计划」在面板里等于凭空消失。范围改成全部未完成后，面板确实会变长，
 * 但那是用户要看的东西 —— 折叠（>8 条「还有 N 条」）与 252px 面板的滚动接住了。
 *
 * ## 已完成为什么只留「今天完成的」
 *
 * 用户这次只要求放开**未完成**的范围，没有要求把全部完成历史铺进面板：
 *   - 已完成是逐日累积的历史，几个月下来可能上百条，252px 宽的窗口会被它占满，
 *     真正要做的待办反而被挤到屏幕外（本末倒置）；
 *   - 面板本身是「今日」面板（表头就是「今日计时」），「今天完成的」才有当天的反馈价值；
 *   - 昨天的完成记录仍可查：`todo_list { includeDone: true }` 一直拿全量，
 *     要改口子只需改本文件一处过滤。
 *
 * 无 `now` 依赖的排序都不做：入参已按 `sortOrder` 升序（`todoStore.sortTodos`），
 * 本文件保序切分，避免面板里出现两套顺序。
 */
import { startOfDay } from './time';
import type { Todo } from '../types/domain';

/** 面板两节的内容：未完成（全部）+ 已完成（仅今天完成的） */
export interface TodoPanelLists {
  pending: Todo[];
  done: Todo[];
}

/**
 * 切分面板两节。
 *
 * 刻意**不**复用 `todoStore` 里原来那个 `splitTodos`（本轮已随 ADR-034 删除，全仓零调用点）：
 * `lib/` 是纯函数层，不该反向依赖状态容器（zustand 会连带把运行时拖进单测）。
 * 这里的判据只有一条 `doneAt == null`，多出来的就是「已完成还要是今天完成的」这一层过滤。
 */
export function todoPanelLists(todos: readonly Todo[], now: number): TodoPanelLists {
  const dayStart = startOfDay(now);
  const pending: Todo[] = [];
  const done: Todo[] = [];
  for (const todo of todos) {
    if (todo.doneAt == null) pending.push(todo);
    else if (todo.doneAt >= dayStart) done.push(todo);
  }
  return { pending, done };
}
