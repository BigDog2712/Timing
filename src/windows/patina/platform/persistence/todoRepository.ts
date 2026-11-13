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
 * （`todo_toggle`）、`:33`（`todo_delete`）、`todo_update`（[0.13] 行编辑）、
 * `todo_create_batch`（[0.13] 批量创建，单事务 1..=60）。
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
 *
 * ## 为什么 `create` 现在要传两个时刻（[本轮]）
 *
 * 用户口径：「新增代办应与新增事项一致，可以填写时间，选择是否提醒」。弹层里那一个
 * **计划时间**同时是 `planned_at`（行上时间胶囊、逾期红字都靠它）；**只有在用户勾了
 * 「提醒我」时**才把同一时刻也写进 `remind_at`。
 *
 * 反过来（无脑两处都写）会让每条待办都在开始前弹两次（宿主 `services/todo_nudge.rs:3-9`
 * 的 T-15 轻提醒 + T-5 问「当前结束后自动开始？」都是以 `remind_at` 为基准的），
 * 所以"不勾"必须是 `remindAt: null`，不能是"等于 plannedAt"。
 *
 * `itemId` 仍传 `null`：条目绑定由后端按标题自动匹配（`services/todo.rs:20-39`），
 * 分析窗不猜。
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
      remindAt: optionalNumber(record.remindAt),
      doneAt: optionalNumber(record.doneAt),
      sortOrder: Number.isFinite(sortOrder) ? sortOrder : 0,
    }];
  });
}

export async function createTodo(
  title: string,
  plannedAt: number | null,
  remindAt: number | null,
): Promise<void> {
  /* 三个参一律显式传（`plannedAt` / `remindAt` 用 `null` 表示"没有"）：
   * 后端 `todo_create` 的签名就是 `(title, item_id, planned_at, remind_at)`，
   * 省略键等于让 Rust 侧落到默认值，两处口径就分家了。 */
  await invokeWithCommandError("todo_create", { title, itemId: null, plannedAt, remindAt });
}

/**
 * 批量创建（[0.13 · 1.7]，多日期 × 多时刻）：**一条命令、后端单事务**。
 *
 * 为什么不是前端循环调 `todo_create`：第 3 条失败会出现"只加了一半"的部分成功，
 * 而且没有回滚手段；"统一添加"的语义就是原子（设计 §3.2）。Rust 侧
 * `todo_create_batch`（`commands/todo_cmd.rs`）1..=60 条、任一校验失败整批回滚。
 * 上限由 `expandTodoBatch`（`TODO_BATCH_MAX = 60`）先拦，这里不重复校验。
 */
export async function createTodoBatch(plans: readonly { title: string; plannedAt: number | null; remindAt: number | null }[]): Promise<void> {
  await invokeWithCommandError("todo_create_batch", {
    todos: plans.map((plan) => ({ title: plan.title, plannedAt: plan.plannedAt, remindAt: plan.remindAt })),
  });
}

/**
 * 编辑一条待办（[0.13 · 1.7]：`todo_update` 命令本就四处齐全，本轮补权限与入口）。
 *
 * patch 语义与 Rust `TodoPatch` 的三态一一对应：`null` = 清空（`remind_at` 清空会
 * 连带复位 `reminded_at` / `remind_stage`，两级提醒按新时刻重来）；不给键 = 不改。
 */
export async function updateTodo(
  id: number,
  patch: { title?: string; plannedAt?: number | null; remindAt?: number | null },
): Promise<void> {
  await invokeWithCommandError("todo_update", { id, patch });
}

export async function toggleTodo(id: number, done: boolean): Promise<void> {
  await invokeWithCommandError("todo_toggle", { id, done });
}

export async function deleteTodo(id: number): Promise<void> {
  await invokeWithCommandError("todo_delete", { id });
}
