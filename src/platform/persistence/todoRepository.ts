import { invokeWithCommandError } from "./commandError.ts";
import type { TodoSummary } from "../../shared/types/todos.ts";

/**
 * 待办网关（分析窗自有）：读 + 三写。
 *
 * 与 `noteReadRepository.ts` 同三条边界（L9 不引主窗 `stores/todoStore`、本目录允许
 * `invokeWithCommandError`、命令名 snake_case / 入参 camelCase）。
 *
 * 命令来源：`src-tauri/src/commands/todo_cmd.rs:41`（`todo_list`，入参 `include_done`
 * / `from` / `to`，`from <= planned_at < to`）、`:19`（`todo_create`）、`:52`
 * （`todo_toggle`）、`:33`（`todo_delete`）。
 *
 * ## 为什么读用 `includeDone: false`
 *
 * 主界面看的是"今天还要做什么"。已完成的进 `doneAt`，由 `todo_toggle` 移出列表；
 * 设计里待办卡没有"已完成"分区（那是独立「待办窗」的事）。
 *
 * ## 为什么**不**按 `from/to` 过滤
 *
 * 便利贴可以按 `updatedAt` 筛"今天动过的"，待办不行：`from/to` 过滤的是 **`planned_at`**，
 * 而用户新加的待办通常**没有排期**（`planned_at = null`）。按今天过滤会把刚写的待办
 * 直接滤掉 —— 一按创建就消失。所以只按"未完成"取，排序交给后端 `sort_order`。
 */
/** `null` 与「缺省」都必须落成 null：`Number(null) === 0` 会把"未排期"变成 epoch（08:00）。 */
function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

export async function listPendingTodos(): Promise<TodoSummary[]> {
  const rows = await invokeWithCommandError<unknown>("todo_list", { includeDone: false });
  if (!Array.isArray(rows)) return [];

  return rows.flatMap((row): TodoSummary[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    if (!Number.isSafeInteger(id)) return [];

    const sortOrder = Number(record.sortOrder);

    return [{
      id,
      title: typeof record.title === "string" ? record.title : "",
      plannedAt: optionalNumber(record.plannedAt),
      doneAt: optionalNumber(record.doneAt),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    }];
  });
}

export async function createTodo(title: string): Promise<void> {
  /* 只传 title：`item_id` / `planned_at` / `remind_at` 是独立「待办窗」的字段，
   * 主界面这一格是"快速记一条"，多问一个字段就把 34px 的输入行变成表单。 */
  await invokeWithCommandError("todo_create", { title, itemId: null, plannedAt: null, remindAt: null });
}

export async function toggleTodo(id: number, done: boolean): Promise<void> {
  await invokeWithCommandError("todo_toggle", { id, done });
}

export async function deleteTodo(id: number): Promise<void> {
  await invokeWithCommandError("todo_delete", { id });
}
