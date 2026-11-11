/**
 * 分析窗自有的待办摘要类型（与 `notes.ts` 同形，理由见该文件顶部）。
 *
 * 字段对应 `src-tauri/src/models/todo.rs:12-31`（serde camelCase）。`itemId` / `remindAt`
 * / `remindedAt` / `updatedAt` 本轮不渲染，先不收 —— 类型只写"用得到的"，多一个字段
 * 就多一处没人验的映射（且 `todo_update` 的 `Option<Option<_>>` 语义容易被误用）。
 */
export interface TodoSummary {
  id: number;
  title: string;
  /** 计划时刻；null = 未排期（`todo_list` 的 from/to 过滤的就是它） */
  plannedAt: number | null;
  /** 完成时刻；null = 未完成 */
  doneAt: number | null;
  /** 手动排序（升序，与后端 `todo_list` 同口径） */
  sortOrder: number;
}
