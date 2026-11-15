import { invokeWithCommandError } from "./commandError.ts";
import type { NoteSummary } from "../../shared/types/notes.ts";

/**
 * 便利贴只读网关（分析窗自己的传输层入口）。
 *
 * 三条边界，缺一条就会被门禁打回：
 *   1. **不能**调 `src/services/api.ts:79` 的 `noteApi.list`（主窗），也不能 `import type`
 *      `src/types/domain-v020.ts` 的 `Note` —— L9 双窗隔离，type import 同样红。
 *   2. 本目录（`src/platform/persistence/`）**不在** `L1_COMPONENT_ROOTS` 里，
 *      所以这里出现 `invokeWithCommandError` 是合法的（与 `sessionReadRepository.ts:106`
 *      的 `cmd_get_executable_icon_rows` 同一写法）。
 *   3. 命令名是 snake_case `note_list`、入参 camelCase（Tauri 2 只把 **参数** 换成
 *      camelCase 传，命令名原样）—— 参照 `src/services/ipc.ts:231`。
 *
 * ## 数据上界（记账，不是缺陷）
 *
 * `note_list` 入参只有 `item_id`，**没有日期过滤、也没有 limit**（`note_cmd.rs:45`），
 * 返回全表。用户攒到几百张时，前端仍只截 3 张渲染，可跑；给 Rust 侧加 limit 是待定项，
 * 不进本轮（改命令签名会动契约与 `domain-v020.ts`）。
 */
export async function listNoteSummaries(): Promise<NoteSummary[]> {
  const rows = await invokeWithCommandError<unknown>("note_list", {});
  if (!Array.isArray(rows)) return [];

  /* 窄化：只留渲染要用的字段，脏行直接丢（不是抛错 —— 一张坏行不该让整条通栏空掉） */
  return rows.flatMap((row): NoteSummary[] => {
    if (!row || typeof row !== "object") return [];
    const record = row as Record<string, unknown>;
    const id = Number(record.id);
    const updatedAt = Number(record.updatedAt);
    const content = typeof record.content === "string" ? record.content : "";
    if (!Number.isSafeInteger(id) || !Number.isFinite(updatedAt)) return [];

    /* `Number(null) === 0` —— 不判类型的话，"独立便签"（itemId: null）会变成挂靠事项 0 */
    const itemId = typeof record.itemId === "number" && Number.isSafeInteger(record.itemId)
      ? record.itemId
      : null;
    const createdAt = typeof record.createdAt === "number" && Number.isFinite(record.createdAt)
      ? record.createdAt
      : updatedAt;

    return [{ id, itemId, content, createdAt, updatedAt }];
  });
}
