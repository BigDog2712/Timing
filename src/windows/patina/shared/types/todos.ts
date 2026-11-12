/**
 * 分析窗自有的待办摘要类型（与 `notes.ts` 同形，理由见该文件顶部）。
 *
 * 字段对应 `src-tauri/src/models/todo.rs:12-31`（serde camelCase）。
 *
 * [本轮 · 新建待办可填时间/提醒] `remindAt` 开始收：行上要据此画一颗铃铛
 * （`TodoComposeDialog` 勾了「提醒我」才会写它，见 `services/todoDraft.ts` 的
 * `planTodoWrite` —— 那是时间口径的唯一实现）。
 *
 * `itemId` / `remindedAt` / `updatedAt` 仍不渲染，仍不收：类型只写"用得到的"，
 * 多一个字段就多一处没人验的映射（且 `todo_update` 的 `Option<Option<_>>` 语义
 * 容易被误用）。
 */
export interface TodoSummary {
  id: number;
  title: string;
  /** 计划时刻；null = 未排期（`todo_list` 的 from/to 过滤的就是它） */
  plannedAt: number | null;
  /** 提醒时刻；null = 用户没勾「提醒我」。宿主两级提醒（T-15 / T-5）以它为基准，
   *  所以"没勾"必须是 null 而不是"等于 plannedAt" */
  remindAt: number | null;
  /** 完成时刻；null = 未完成 */
  doneAt: number | null;
  /** 手动排序（升序，与后端 `todo_list` 同口径） */
  sortOrder: number;
}
