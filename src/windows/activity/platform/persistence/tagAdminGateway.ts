import { invokeWithCommandError } from "./commandError.ts";

/**
 * 分析窗的**标签目录写面**（数据页「标签管理」用）。
 *
 * 与 `timingReadRepository.ts` 同一套纪律：
 *   1. 不 import 主窗的 `src/services/api.ts`（L9 双窗隔离），命令名 snake_case、
 *      入参 camelCase 由本文件自己拼；
 *   2. ACL 是 `permissions/activity-host-tags.toml` 那四条 —— 只有「整棵树的
 *      管理动作」，逐条写事项标签仍走 host-intent 事件桥（药丸侧执行）。
 *   3. 出参一律收成前端形状：后端回什么就在这里校验一遍，脏行直接丢掉，
 *      不让一个坏字段把整页打不开。
 */

export interface TagMutationResult {
  /** 被改到 / 被删到的未删除事项条数 */
  items: number;
  /** 操作后的全部标签定义 */
  definitions: string[];
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

/** 全部标签定义（`settings` 的 `tag.def.*`）。 */
export async function listTagDefinitions(): Promise<string[]> {
  return toStringList(await invokeWithCommandError<unknown>("list_tag_catalog", {}));
}

export async function createTagDefinition(path: string): Promise<string[]> {
  return toStringList(await invokeWithCommandError<unknown>("create_tag_definition", { path }));
}

/** 改名（含子树）。所有引用该路径的事项与定义行在后端一个事务里改完。 */
export async function renameTagPath(from: string, to: string): Promise<TagMutationResult> {
  return readMutation(await invokeWithCommandError<unknown>("rename_tag", { from, to }));
}

/** 删除（含子树）。 */
export async function deleteTagPath(path: string): Promise<TagMutationResult> {
  return readMutation(await invokeWithCommandError<unknown>("delete_tag", { path }));
}

function readMutation(raw: unknown): TagMutationResult {
  if (!raw || typeof raw !== "object") return { items: 0, definitions: [] };
  const record = raw as Record<string, unknown>;
  return {
    items: Number.isSafeInteger(record.items) ? Number(record.items) : 0,
    definitions: toStringList(record.definitions),
  };
}
