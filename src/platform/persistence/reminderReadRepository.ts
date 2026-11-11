import { invokeWithCommandError } from "./commandError.ts";

/**
 * 提醒只读网关（分析窗自己的传输层入口）。
 *
 * 三条边界照 `noteReadRepository.ts` 的既有写法，缺一条门禁就红：
 *   1. **不能**调 `src/services/api.ts` 的 `reminderApi.pending`，也不能 `import type`
 *      `src/types/domain-v020.ts` 的 `Reminder` —— L9 双窗隔离，type import 同样算。
 *   2. 本目录（`src/platform/persistence/`）不在 `L1_COMPONENT_ROOTS` 里，
 *      `invokeWithCommandError` 在这里是合法的。
 *   3. 命令名 snake_case `reminder_pending`、无入参（参照 `src/services/ipc.ts:263`）。
 *
 * 语义：返回**还没触发完**的提醒，不是历史。已经响过并处理掉的不在这里 ——
 * 所以卡片的文案是"待提醒"，写成"今日提醒"会让人以为漏了。
 */
export type PendingReminderTarget = "item" | "todo";

export interface PendingReminder {
  target: PendingReminderTarget;
  targetId: number;
  /** 目标标题（事项名或待办标题），后端已算好，前端不再回查 */
  title: string;
  /** 提醒时刻（epoch 毫秒） */
  remindAt: number;
}

export async function listPendingReminders(): Promise<PendingReminder[]> {
  const rows = await invokeWithCommandError<unknown>("reminder_pending", {});
  if (!Array.isArray(rows)) return [];

  /* 窄化：脏行直接丢（一条坏行不该让整张卡空掉），不抛错 */
  return rows.flatMap((row): PendingReminder[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const target = record.target;
    if (target !== "item" && target !== "todo") return [];
    const targetId = Number(record.targetId);
    const remindAt = Number(record.remindAt);
    if (!Number.isSafeInteger(targetId) || !Number.isFinite(remindAt)) return [];
    const title = typeof record.title === "string" ? record.title : "";
    return [{ target, targetId, title, remindAt }];
  });
}
