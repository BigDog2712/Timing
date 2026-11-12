/**
 * Timing — 待办两项时间的语义与改写（唯一出口，纯函数）
 * -----------------------------------------------------------------------------
 * 用户口径（V0.3.10）：
 *   - 「待办时间写不进去」：创建后**没有任何入口**能改时间，行上也只看得到截止时刻，
 *     开启时间写进去就再也看不见 —— 本文件给「改哪一项、改成什么」一个统一口径；
 *   - 「待办时间应可空置」：两项都可以是 `null`（未排期 / 无提醒），也都可以**改回空**。
 *
 * 字段语义（与 `TodosComposeCard` 一致，不要在这里重新发明）：
 *   - `remind`  → `remind_at`「开启时间」：到点提醒的时刻（行上小铃铛）；
 *   - `planned` → `planned_at`「截止时间」：逾期判定基准（`TodosPendingRow.pendingTone`）。
 *
 * 校验只做一件事：**截止不能早于开启**（与新增卡 `TodosComposeCard.submit` 同一条规则）。
 * 任一侧为空就不比较——「只设截止」「只设开启」都是合法状态。
 */
import type { Todo, TodoPatch } from '../types/domain';

/** 行内可点开改的两种时间 */
export type TodoTimeField = 'remind' | 'planned';

/** 字段 → 中文标签（行内 aria / 提示 / 报错共用一处，避免三处措辞漂移） */
export const TODO_TIME_LABEL: Record<TodoTimeField, string> = {
  remind: '开启时间',
  planned: '截止时间',
};

export type TodoTimeResult = { ok: true; patch: TodoPatch } | { ok: false; error: string };

/**
 * 把「某一行、某一项时间改成 `ms`」翻译成 `todo_update` 的 patch。
 *
 * `ms = null` 是**合法输入**（清除该项），不是「没改」：因此 patch 里显式带 `null`，
 * 后端 `TodoPatch` 的 `double_option` 会把它落成 SQL `NULL`（`repositories::todo::update`）。
 */
export function todoTimePatch(
  todo: Pick<Todo, 'remindAt' | 'plannedAt'>,
  field: TodoTimeField,
  ms: number | null,
): TodoTimeResult {
  if (ms != null && !Number.isFinite(ms)) return { ok: false, error: '时间无效，请重新选择' };

  const remindAt = field === 'remind' ? ms : todo.remindAt;
  const plannedAt = field === 'planned' ? ms : todo.plannedAt;
  if (remindAt != null && plannedAt != null && plannedAt < remindAt) {
    return { ok: false, error: '截止时间不能早于开启时间' };
  }

  return { ok: true, patch: field === 'remind' ? { remindAt: ms } : { plannedAt: ms } };
}
